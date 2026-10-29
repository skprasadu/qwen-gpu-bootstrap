use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
async fn request(app: &axum::Router, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
#[tokio::test]
async fn crud_and_validation() {
    let app = p2i_todo::router();
    assert_eq!(
        request(&app, "POST", "/api/todos", json!({"title":" "}))
            .await
            .0,
        400
    );
    assert_eq!(
        request(&app, "POST", "/api/todos", json!({"title":"x".repeat(201)}))
            .await
            .0,
        400
    );
    let (status, todo) = request(&app, "POST", "/api/todos", json!({"title":" first "})).await;
    assert_eq!(status, 201);
    assert_eq!(todo["title"], "first");
    assert_eq!(todo["completed"], false);
    let path = format!("/api/todos/{}", todo["id"]);
    let (_, changed) = request(
        &app,
        "PATCH",
        &path,
        json!({"title":"edited","completed":true}),
    )
    .await;
    assert_eq!(changed["title"], "edited");
    assert_eq!(changed["completed"], true);
    assert_eq!(
        request(&app, "PATCH", &path, json!({"completed":false}))
            .await
            .1["completed"],
        false
    );
    assert_eq!(
        request(&app, "GET", "/api/todos", Value::Null)
            .await
            .1
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(request(&app, "DELETE", &path, Value::Null).await.0, 204);
    assert_eq!(request(&app, "DELETE", &path, Value::Null).await.0, 404);
    assert_eq!(
        request(&app, "PATCH", &path, json!({"completed":true}))
            .await
            .0,
        404
    );
}
#[tokio::test]
async fn independent_instances_start_empty() {
    let app = p2i_todo::router();
    request(&app, "POST", "/api/todos", json!({"title":"one"})).await;
    let other = p2i_todo::router();
    assert_eq!(
        request(&other, "GET", "/api/todos", Value::Null).await.1,
        json!([])
    );
}
