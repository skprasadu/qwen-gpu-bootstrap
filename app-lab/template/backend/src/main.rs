use utoipa::OpenApi;
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::args().any(|arg| arg == "--openapi") {
        println!("{}", p2i_todo::Api::openapi().to_pretty_json()?);
        return Ok(());
    }
    let address = std::env::var("BACKEND_ADDR").unwrap_or_else(|_| "127.0.0.1:3000".into());
    let listener = tokio::net::TcpListener::bind(&address).await?;
    println!("Listening on {}", listener.local_addr()?);
    axum::serve(listener, p2i_todo::router()).await?;
    Ok(())
}
