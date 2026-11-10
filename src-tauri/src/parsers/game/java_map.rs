//! Java HashMap iteration is observable when JSONObject is converted into a key.
use crate::models::file_value::{Text, Value};
use std::cmp::Ordering;
use std::mem;

#[derive(Default, Clone)]
struct Link {
    parent: Option<usize>,
    left: Option<usize>,
    right: Option<usize>,
    red: bool,
}
struct Map<'a> {
    fields: &'a [(Text, Value)],
    hashes: Vec<u32>,
    links: Vec<Link>,
    bins: Vec<Vec<usize>>,
    trees: Vec<bool>,
}
impl Map<'_> {
    fn compare(&self, a: usize, b: usize) -> Ordering {
        (self.hashes[a] as i32)
            .cmp(&(self.hashes[b] as i32))
            .then_with(|| self.fields[a].0.cmp(&self.fields[b].0))
    }
    fn rotate(&mut self, root: usize, p: usize, left: bool) -> usize {
        let r = if left {
            self.links[p].right
        } else {
            self.links[p].left
        }
        .expect("rotation child");
        let child = if left {
            self.links[r].left
        } else {
            self.links[r].right
        };
        if left {
            self.links[p].right = child;
        } else {
            self.links[p].left = child;
        }
        if let Some(child) = child {
            self.links[child].parent = Some(p);
        }
        let parent = self.links[p].parent;
        self.links[r].parent = parent;
        let next = if let Some(parent) = parent {
            if self.links[parent].left == Some(p) {
                self.links[parent].left = Some(r);
            } else {
                self.links[parent].right = Some(r);
            }
            root
        } else {
            self.links[r].red = false;
            r
        };
        if left {
            self.links[r].left = Some(p);
        } else {
            self.links[r].right = Some(p);
        }
        self.links[p].parent = Some(r);
        next
    }
    fn balance(&mut self, mut root: usize, mut x: usize) -> usize {
        self.links[x].red = true;
        loop {
            let Some(parent) = self.links[x].parent else {
                self.links[x].red = false;
                return x;
            };
            if !self.links[parent].red {
                return root;
            }
            let Some(grand) = self.links[parent].parent else {
                return root;
            };
            let left = self.links[grand].left == Some(parent);
            let uncle = if left {
                self.links[grand].right
            } else {
                self.links[grand].left
            };
            if uncle.is_some_and(|u| self.links[u].red) {
                self.links[uncle.expect("red uncle")].red = false;
                self.links[parent].red = false;
                self.links[grand].red = true;
                x = grand;
            } else {
                let inner = if left {
                    self.links[parent].right
                } else {
                    self.links[parent].left
                };
                let (parent, grand) = if inner == Some(x) {
                    root = self.rotate(root, parent, left);
                    x = parent;
                    let p = self.links[x].parent.expect("rotated parent");
                    (p, self.links[p].parent.expect("rotated grandparent"))
                } else {
                    (parent, grand)
                };
                self.links[parent].red = false;
                self.links[grand].red = true;
                root = self.rotate(root, grand, !left);
            }
        }
    }
    fn tree_insert(&mut self, root: usize, x: usize) -> (usize, usize) {
        let mut p = root;
        loop {
            let left = self.compare(x, p) == Ordering::Less;
            let child = if left {
                self.links[p].left
            } else {
                self.links[p].right
            };
            if let Some(child) = child {
                p = child;
            } else {
                self.links[x] = Link {
                    parent: Some(p),
                    ..Link::default()
                };
                if left {
                    self.links[p].left = Some(x);
                } else {
                    self.links[p].right = Some(x);
                }
                return (self.balance(root, x), p);
            }
        }
    }
    fn front(&mut self, bin: usize, root: usize) {
        let at = self.bins[bin]
            .iter()
            .position(|i| *i == root)
            .expect("root in bin");
        self.bins[bin].remove(at);
        self.bins[bin].insert(0, root);
    }
    fn treeify(&mut self, bin: usize) {
        let chain = self.bins[bin].clone();
        let mut root = chain[0];
        self.links[root] = Link::default();
        for &x in &chain[1..] {
            root = self.tree_insert(root, x).0;
        }
        self.trees[bin] = true;
        self.front(bin, root);
    }
    fn resize(&mut self) {
        let capacity = self.bins.len();
        let old = mem::replace(&mut self.bins, vec![Vec::new(); capacity * 2]);
        let trees = mem::replace(&mut self.trees, vec![false; capacity * 2]);
        for (bin, chain) in old.into_iter().enumerate() {
            for x in chain {
                let at = self.hashes[x] as usize & (capacity * 2 - 1);
                self.bins[at].push(x);
            }
            if trees[bin] {
                let split = !self.bins[bin].is_empty() && !self.bins[bin + capacity].is_empty();
                for at in [bin, bin + capacity] {
                    if self.bins[at].len() > 6 {
                        if split {
                            self.treeify(at);
                        } else {
                            self.trees[at] = true;
                        }
                    }
                }
            }
        }
    }
    fn insert(&mut self, x: usize) {
        let bin = self.hashes[x] as usize & (self.bins.len() - 1);
        if self.trees[bin] {
            let root = self.bins[bin][0];
            let (root, parent) = self.tree_insert(root, x);
            let at = self.bins[bin]
                .iter()
                .position(|i| *i == parent)
                .expect("parent in chain");
            self.bins[bin].insert(at + 1, x);
            self.front(bin, root);
        } else {
            self.bins[bin].push(x);
            if self.bins[bin].len() >= 9 {
                if self.bins.len() < 64 {
                    self.resize();
                } else {
                    self.treeify(bin);
                }
            }
        }
        if x + 1 > self.bins.len() * 3 / 4 {
            self.resize();
        }
    }
}
pub fn order(fields: &[(Text, Value)]) -> Vec<usize> {
    let hashes = fields
        .iter()
        .map(|(k, _)| {
            let h = k.java_hash();
            h ^ (h >> 16)
        })
        .collect();
    let mut map = Map {
        fields,
        hashes,
        links: vec![Link::default(); fields.len()],
        bins: vec![Vec::new(); 16],
        trees: vec![false; 16],
    };
    for x in 0..fields.len() {
        map.insert(x);
    }
    map.bins.into_iter().flatten().collect()
}
