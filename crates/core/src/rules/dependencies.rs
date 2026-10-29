//! Walk a Condition tree and extract `(ref_kind, ref_id)` pairs. Used by
//! `db::rules::save` to refresh the `rule_dependencies` index.

use crate::rules::condition::Condition;
use crate::rules::field;
use std::collections::HashSet;
use uuid::Uuid;

pub fn extract(condition: &Condition) -> Vec<(String, Uuid)> {
    let mut seen: HashSet<(String, Uuid)> = HashSet::new();
    walk(condition, &mut seen);
    seen.into_iter().collect()
}

fn walk(c: &Condition, seen: &mut HashSet<(String, Uuid)>) {
    match c {
        Condition::Comparison { field, .. } => {
            if let Ok(r) = field::parse(field) {
                let (kind, id) = field::ref_pair(&r);
                seen.insert((kind.to_string(), id));
            }
        }
        Condition::Logical { children, .. } => {
            for child in children {
                walk(child, seen);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::condition::{CompOp, LogicalOp};
    use serde_json::json;

    fn leaf(field: String) -> Condition {
        Condition::Comparison {
            field,
            operator: CompOp::Eq,
            value: json!("critical"),
            for_duration: None,
        }
    }

    #[test]
    fn extract_dedupes_repeated_refs() {
        let id = Uuid::new_v4();
        let cond = Condition::Logical {
            op: LogicalOp::And,
            children: vec![
                leaf(format!("monitor:{id}:cpu")),
                leaf(format!("monitor:{id}:state")),
            ],
        };
        let deps = extract(&cond);
        assert_eq!(deps, vec![("monitor".to_string(), id)]);
    }

    #[test]
    fn extract_walks_nested_logical_trees() {
        let m1 = Uuid::new_v4();
        let m2 = Uuid::new_v4();
        let g = Uuid::new_v4();
        let cond = Condition::Logical {
            op: LogicalOp::And,
            children: vec![
                Condition::Logical {
                    op: LogicalOp::Or,
                    children: vec![
                        leaf(format!("monitor:{m1}:state")),
                        leaf(format!("group:{g}:critical_count")),
                    ],
                },
                leaf(format!("monitor:{m2}:mem")),
            ],
        };
        let mut deps = extract(&cond);
        deps.sort();
        let mut expected = vec![
            ("monitor".to_string(), m1),
            ("monitor".to_string(), m2),
            ("group".to_string(), g),
        ];
        expected.sort();
        assert_eq!(deps, expected);
    }

    #[test]
    fn extract_skips_unparseable_fields() {
        let id = Uuid::new_v4();
        let cond = Condition::Logical {
            op: LogicalOp::Or,
            children: vec![leaf("bogus".to_string()), leaf(format!("monitor:{id}:state"))],
        };
        assert_eq!(extract(&cond), vec![("monitor".to_string(), id)]);
    }
}
