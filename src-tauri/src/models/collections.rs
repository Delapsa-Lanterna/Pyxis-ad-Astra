pub(crate) fn push_unique_all<T: PartialEq>(target: &mut Vec<T>, values: Vec<T>) {
    for value in values {
        if !target.contains(&value) {
            target.push(value);
        }
    }
}

#[cfg(test)]
mod tests {
    #[cfg(test)]
    use crate::models::collections::push_unique_all;

    #[test]
    fn unique_append_preserves_existing_order_and_first_new_occurrence() {
        let mut values = vec!["first", "first", "second"];
        push_unique_all(&mut values, vec!["second", "third", "third", "fourth"]);
        assert_eq!(values, ["first", "first", "second", "third", "fourth"]);
        push_unique_all(&mut values, Vec::new());
        assert_eq!(values, ["first", "first", "second", "third", "fourth"]);
    }
}
