//! Decimal selection for Java 17 numeric object keys.
//! Uses integer scaling and a symmetric half-ULP stopping interval.
use std::cmp::Ordering;
use std::iter;

#[derive(Clone)]
struct Nat(Vec<u32>);
impl Nat {
    fn new(n: u64) -> Self {
        let mut v = vec![n as u32];
        if n >> 32 != 0 {
            v.push((n >> 32) as u32);
        }
        Self(v)
    }
    fn mul(&mut self, n: u32) {
        let mut carry = 0u64;
        for w in &mut self.0 {
            let x = *w as u64 * n as u64 + carry;
            *w = x as u32;
            carry = x >> 32;
        }
        if carry != 0 {
            self.0.push(carry as u32);
        }
    }
    fn shifted(mut self, n: i32) -> Self {
        let words = n as usize / 32;
        let bits = n as usize % 32;
        if words > 0 {
            self.0.splice(0..0, iter::repeat_n(0, words));
        }
        if bits > 0 {
            let mut carry = 0u64;
            for w in &mut self.0 {
                let x = ((*w as u64) << bits) | carry;
                *w = x as u32;
                carry = x >> 32;
            }
            if carry != 0 {
                self.0.push(carry as u32);
            }
        }
        self
    }
    fn scaled(n: u64, p5: i32, p2: i32) -> Self {
        let mut v = Self::new(n);
        for _ in 0..p5 {
            v.mul(5);
        }
        v.shifted(p2)
    }
    fn cmp(&self, b: &Self) -> Ordering {
        self.0
            .len()
            .cmp(&b.0.len())
            .then_with(|| self.0.iter().rev().cmp(b.0.iter().rev()))
    }
    fn sub(&mut self, b: &Self) {
        let mut borrow = 0u64;
        for (i, w) in self.0.iter_mut().enumerate() {
            let sub = b.0.get(i).copied().unwrap_or(0) as u64 + borrow;
            let a = *w as u64;
            *w = a.wrapping_sub(sub) as u32;
            borrow = (a < sub) as u64;
        }
        while self.0.len() > 1 && self.0.last() == Some(&0) {
            self.0.pop();
        }
    }
    fn plus(&self, b: &Self) -> Self {
        let mut out = self.clone();
        out.0.resize(self.0.len().max(b.0.len()), 0);
        let mut carry = 0u64;
        for (i, w) in out.0.iter_mut().enumerate() {
            let n = *w as u64 + b.0.get(i).copied().unwrap_or(0) as u64 + carry;
            *w = n as u32;
            carry = n >> 32;
        }
        if carry != 0 {
            out.0.push(carry as u32);
        }
        out
    }
    fn digit(&mut self, s: &Self) -> u8 {
        let mut n = 0;
        while self.cmp(s) != Ordering::Less {
            self.sub(s);
            n += 1;
        }
        self.mul(10);
        n
    }
}
fn bits5(n: i32) -> i32 {
    const B: [i32; 27] = [
        0, 3, 5, 7, 10, 12, 14, 17, 19, 21, 24, 26, 28, 31, 33, 35, 38, 40, 42, 45, 47, 49, 52, 54,
        56, 59, 61,
    ];
    B.get(n as usize).copied().unwrap_or(n * 3)
}
// These decimal-estimate coefficients are part of Java's digit selection.
#[allow(clippy::approx_constant)]
fn digits(value: f64) -> (Vec<u8>, i32) {
    let bits = value.to_bits();
    let fraction = bits & ((1u64 << 52) - 1);
    let exponent = ((bits >> 52) & 0x7ff) as i32;
    let (fract, bin, sig) = if exponent == 0 {
        let shift = fraction.leading_zeros() as i32 - 11;
        (
            fraction << shift,
            1 - shift - 1023,
            64 - fraction.leading_zeros() as i32,
        )
    } else {
        (fraction | (1 << 52), exponent - 1023, 53)
    };
    let zeros = fract.trailing_zeros() as i32;
    let count = 53 - zeros;
    let tiny = (count - bin - 1).max(0);
    if (-21..=62).contains(&bin) && tiny == 0 {
        let mut integer = if bin >= 52 {
            fract << (bin - 52)
        } else {
            fract >> (52 - bin)
        };
        let power = bin - sig - 1;
        if power > 1 {
            let insignificant = (1u64 << power).ilog10();
            if insignificant > 0 {
                let factor = 10u64.pow(insignificant);
                let residue = integer % factor;
                integer /= factor;
                if residue >= factor / 2 {
                    integer += 1;
                }
                let text = integer.to_string();
                let e = text.len() as i32 + insignificant as i32;
                let mut d = text.bytes().map(|b| b - b'0').collect::<Vec<_>>();
                while d.len() > 1 && d.last() == Some(&0) {
                    d.pop();
                }
                return (d, e);
            }
        }
        let text = integer.to_string();
        let e = text.len() as i32;
        let mut d = text.bytes().map(|b| b - b'0').collect::<Vec<_>>();
        while d.len() > 1 && d.last() == Some(&0) {
            d.pop();
        }
        return (d, e);
    }
    let normalized = f64::from_bits((1023u64 << 52) | (fract & ((1 << 52) - 1)));
    let mut exp =
        ((normalized - 1.5) * 0.289529654 + 0.176091259 + (bin as f64) * 0.301029995663981).floor()
            as i32;
    let b5 = (-exp).max(0);
    let s5 = exp.max(0);
    let mut b2 = b5 + tiny + bin;
    let mut s2 = s5 + tiny;
    let mut m2 = b2 - sig;
    b2 -= count - 1;
    let common = b2.min(s2);
    b2 -= common;
    s2 -= common;
    m2 -= common;
    if count == 1 {
        m2 -= 1;
    }
    if m2 < 0 {
        b2 -= m2;
        s2 -= m2;
        m2 = 0;
    }
    let big = count + b2 + bits5(b5) >= 64 || s2 + 1 + bits5(s5 + 1) >= 64;
    let mut b = Nat::scaled(fract >> zeros, b5, b2);
    let s = Nat::scaled(1, s5, s2);
    let mut m = Nat::scaled(1, b5, m2);
    let mut tens = s.clone();
    tens.mul(10);
    let mut out = Vec::with_capacity(18);
    let q = b.digit(&s);
    m.mul(10);
    let mut low = b.cmp(&m) == Ordering::Less;
    let c = b.plus(&m).cmp(&tens);
    let mut high = if big {
        c != Ordering::Less
    } else {
        c == Ordering::Greater
    };
    if q == 0 && !high {
        exp -= 1;
    } else {
        out.push(q);
    }
    if !(-3..8).contains(&exp) {
        low = false;
        high = false;
    }
    while !low && !high {
        let q = b.digit(&s);
        m.mul(10);
        low = b.cmp(&m) == Ordering::Less;
        let c = b.plus(&m).cmp(&tens);
        high = if big {
            c != Ordering::Less
        } else {
            c == Ordering::Greater
        };
        out.push(q);
    }
    let difference = b.clone().shifted(1).cmp(&tens);
    if high
        && (!low
            || difference == Ordering::Greater
            || difference == Ordering::Equal && out.last().expect("digit") & 1 != 0)
    {
        let mut i = out.len() - 1;
        while i > 0 && out[i] == 9 {
            out[i] = 0;
            i -= 1;
        }
        if out[i] == 9 {
            out[i] = 1;
            exp += 1;
        } else {
            out[i] += 1;
        }
    }
    (out, exp + 1)
}
pub fn format(value: f64) -> String {
    if value.is_nan() {
        return "NaN".into();
    }
    if value == f64::INFINITY {
        return "Infinity".into();
    }
    if value == f64::NEG_INFINITY {
        return "-Infinity".into();
    }
    if value == 0.0 {
        return if value.is_sign_negative() {
            "-0.0".into()
        } else {
            "0.0".into()
        };
    }
    let (d, e) = digits(value.abs());
    let mut out = String::with_capacity(26);
    if value.is_sign_negative() {
        out.push('-');
    }
    if e > 0 && e < 8 {
        for i in 0..e as usize {
            out.push((b'0' + d.get(i).copied().unwrap_or(0)) as char);
        }
        out.push('.');
        if d.len() > e as usize {
            for n in &d[e as usize..] {
                out.push((b'0' + n) as char);
            }
        } else {
            out.push('0');
        }
    } else if e <= 0 && e > -3 {
        out.push_str("0.");
        for _ in 0..-e {
            out.push('0');
        }
        for n in d {
            out.push((b'0' + n) as char);
        }
    } else {
        out.push((b'0' + d[0]) as char);
        out.push('.');
        if d.len() == 1 {
            out.push('0');
        } else {
            for n in &d[1..] {
                out.push((b'0' + n) as char);
            }
        }
        out.push('E');
        out.push_str(&(e - 1).to_string());
    }
    out
}
