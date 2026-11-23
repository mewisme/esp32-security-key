//! Human vs JSON output. JSON is pretty-printed with stable snake_case field names and goes to stdout only;
//! diagnostics and prompts go to stderr.

use std::io::{self, Write};

use serde::Serialize;

use crate::error::{msg, Res};

pub fn emit<T: Serialize>(
    out: &mut dyn Write,
    json: bool,
    value: &T,
    human: impl FnOnce(&mut dyn Write) -> io::Result<()>,
) -> Res {
    if json {
        let s = serde_json::to_string_pretty(value).map_err(msg)?;
        writeln!(out, "{s}").map_err(msg)
    } else {
        human(out).map_err(msg)
    }
}
