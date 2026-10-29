use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::get,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    sync::{Arc, RwLock},
};
use utoipa::{OpenApi, ToSchema};

#[derive(Clone, Serialize, Deserialize, ToSchema)]
pub struct Todo {
    pub id: u32,
    pub title: String,
    pub completed: bool,
}
#[derive(Deserialize, ToSchema)]
pub struct CreateTodo {
    pub title: String,
}
#[derive(Deserialize, ToSchema)]
pub struct UpdateTodo {
    pub title: Option<String>,
    pub completed: Option<bool>,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct ApiError {
    pub error: String,
}
#[derive(Default)]
pub struct Store {
    next: u32,
    todos: BTreeMap<u32, Todo>,
}
type Shared = Arc<RwLock<Store>>;
type Failure = (StatusCode, Json<ApiError>);
fn error(status: StatusCode, message: &str) -> Failure {
    (
        status,
        Json(ApiError {
            error: message.into(),
        }),
    )
}
fn title(value: &str) -> Result<String, Failure> {
    let text = value.trim();
    if text.is_empty() || text.chars().count() > 200 {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "Title must contain 1–200 characters",
        ));
    }
    Ok(text.into())
}
#[utoipa::path(get, path="/api/todos", operation_id="listTodos", responses((status=200, body=Vec<Todo>)))]
async fn list(State(store): State<Shared>) -> Result<Json<Vec<Todo>>, Failure> {
    let guard = store
        .read()
        .map_err(|_| error(StatusCode::INTERNAL_SERVER_ERROR, "Store unavailable"))?;
    Ok(Json(guard.todos.values().cloned().collect()))
}
#[utoipa::path(post, path="/api/todos", operation_id="createTodo", request_body=CreateTodo, responses((status=201, body=Todo), (status=400, body=ApiError)))]
async fn create(
    State(store): State<Shared>,
    Json(body): Json<CreateTodo>,
) -> Result<(StatusCode, Json<Todo>), Failure> {
    let text = title(&body.title)?;
    let mut guard = store
        .write()
        .map_err(|_| error(StatusCode::INTERNAL_SERVER_ERROR, "Store unavailable"))?;
    guard.next = guard
        .next
        .checked_add(1)
        .ok_or_else(|| error(StatusCode::INTERNAL_SERVER_ERROR, "ID space exhausted"))?;
    let todo = Todo {
        id: guard.next,
        title: text,
        completed: false,
    };
    guard.todos.insert(todo.id, todo.clone());
    Ok((StatusCode::CREATED, Json(todo)))
}
#[utoipa::path(patch, path="/api/todos/{id}", operation_id="updateTodo", params(("id"=u32, Path)), request_body=UpdateTodo, responses((status=200, body=Todo), (status=400, body=ApiError), (status=404, body=ApiError)))]
async fn update(
    State(store): State<Shared>,
    Path(id): Path<u32>,
    Json(body): Json<UpdateTodo>,
) -> Result<Json<Todo>, Failure> {
    let text = body.title.as_deref().map(title).transpose()?;
    let mut guard = store
        .write()
        .map_err(|_| error(StatusCode::INTERNAL_SERVER_ERROR, "Store unavailable"))?;
    let todo = guard
        .todos
        .get_mut(&id)
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "Todo not found"))?;
    if let Some(text) = text {
        todo.title = text;
    }
    if let Some(done) = body.completed {
        todo.completed = done;
    }
    Ok(Json(todo.clone()))
}
#[utoipa::path(delete, path="/api/todos/{id}", operation_id="deleteTodo", params(("id"=u32, Path)), responses((status=204), (status=404, body=ApiError)))]
async fn delete(State(store): State<Shared>, Path(id): Path<u32>) -> Result<StatusCode, Failure> {
    let mut guard = store
        .write()
        .map_err(|_| error(StatusCode::INTERNAL_SERVER_ERROR, "Store unavailable"))?;
    guard
        .todos
        .remove(&id)
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "Todo not found"))?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(OpenApi)]
#[openapi(
    paths(list, create, update, delete),
    components(schemas(Todo, CreateTodo, UpdateTodo, ApiError))
)]
pub struct Api;
pub fn router() -> Router {
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/api/openapi.json", get(|| async { Json(Api::openapi()) }))
        .route("/api/todos", get(list).post(create))
        .route(
            "/api/todos/{id}",
            axum::routing::patch(update).delete(delete),
        )
        .with_state(Arc::new(RwLock::new(Store::default())))
}
