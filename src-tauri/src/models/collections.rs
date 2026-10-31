pub(crate) fn push_unique_all<T: PartialEq>(target: &mut Vec<T>, values: Vec<T>) {
    for value in values {
        if !target.contains(&value) {
            target.push(value);
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn unique_append_preserves_existing_order_and_first_new_occurrence() {
        let mut values = vec!["first", "first", "second"];
        super::push_unique_all(&mut values, vec!["second", "third", "third", "fourth"]);
        assert_eq!(values, ["first", "first", "second", "third", "fourth"]);
        super::push_unique_all(&mut values, Vec::new());
        assert_eq!(values, ["first", "first", "second", "third", "fourth"]);
    }
}
