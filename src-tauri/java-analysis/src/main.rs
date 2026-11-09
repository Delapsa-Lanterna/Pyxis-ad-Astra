use pyxis_java_analysis::{AnalysisRuntime, Error, Result};
use serde_json::{Value, json};
use std::env;
use std::fs::File;
use std::io::{self, BufRead, Write};
use std::path::Path;
use std::process;
use std::sync::Arc;

fn run() -> Result<()> {
    let args: Vec<_> = env::args().collect();
    if args.len() != 3 {
        return Err(Error::Invalid(
            "Usage: java-analysis <status|install|import|remove|run> input.json".into(),
        ));
    }
    let input: Value = serde_json::from_reader(File::open(&args[2])?)?;
    let field = |key| {
        input[key]
            .as_str()
            .ok_or_else(|| Error::Invalid(format!("Missing {key}")))
    };
    let runtime = AnalysisRuntime::new(
        Path::new(field("configRoot")?),
        Arc::new(|event| {
            if let Some(error) = event.error {
                eprintln!("{}: {error}", event.code);
            }
        }),
    )?;
    let result = match args[1].as_str() {
        "status" => {
            json!({"installed":runtime.installed()?,"paths":runtime.paths(),"package":runtime.package()})
        }
        "install" => json!({"directory":runtime.install()?}),
        "import" => json!({"directory":runtime.import(Path::new(field("archive")?))?}),
        "remove" => {
            runtime.remove_dependencies()?;
            json!({"removed":true})
        }
        "run" => {
            let id = runtime.start(Path::new(field("java")?))?;
            for line in io::stdin().lock().lines() {
                let request = serde_json::from_str(&line?)?;
                println!("{}", runtime.request(&id, &request)?);
                io::stdout().flush()?;
            }
            runtime.close(&id)?;
            runtime.shutdown()?;
            return Ok(());
        }
        _ => return Err(Error::Invalid("Unknown Java analysis command".into())),
    };
    runtime.shutdown()?;
    println!("{result}");
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!(
            "{}",
            json!({"code":"java_analysis.failed","message":error.to_string()})
        );
        process::exit(1);
    }
}
