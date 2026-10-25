use crate::auth::{ApiError, ApiResult, AppState, UserId};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, put},
};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

pub async fn own_folder(state: &AppState, user: Uuid, folder: Uuid) -> ApiResult<()> {
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM image_folders WHERE id=$1 AND user_id=$2)")
            .bind(folder)
            .bind(user)
            .fetch_one(&state.pool)
            .await?;
    if !exists {
        return Err(ApiError(StatusCode::NOT_FOUND, "folder not found"));
    }
    Ok(())
}
async fn list(State(state): State<AppState>, UserId(user): UserId) -> ApiResult<Json<Value>> {
    let rows:Vec<String>=sqlx::query_scalar("SELECT json_build_object('id',f.id,'name',f.name,'image_count',count(i.id))::text FROM image_folders f LEFT JOIN images i ON i.folder_id=f.id AND i.user_id=f.user_id WHERE f.user_id=$1 GROUP BY f.id ORDER BY lower(f.name)").bind(user).fetch_all(&state.pool).await?;
    let values = rows
        .iter()
        .map(|s| serde_json::from_str::<Value>(s))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "invalid folder response"))?;
    Ok(Json(json!(values)))
}
#[derive(Deserialize)]
struct Name {
    name: String,
}
fn name(value: String) -> ApiResult<String> {
    let value = value.trim().to_owned();
    if value.is_empty() || value.chars().count() > 100 {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "folder name must be 1–100 characters",
        ));
    }
    Ok(value)
}
async fn create(
    State(state): State<AppState>,
    UserId(user): UserId,
    Json(body): Json<Name>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let name = name(body.name)?;
    let id: Uuid =
        sqlx::query_scalar("INSERT INTO image_folders(user_id,name) VALUES($1,$2) RETURNING id")
            .bind(user)
            .bind(&name)
            .fetch_one(&state.pool)
            .await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"id":id,"name":name,"image_count":0})),
    ))
}
async fn rename(
    State(state): State<AppState>,
    UserId(user): UserId,
    Path(folder): Path<Uuid>,
    Json(body): Json<Name>,
) -> ApiResult<StatusCode> {
    own_folder(&state, user, folder).await?;
    sqlx::query("UPDATE image_folders SET name=$2 WHERE id=$1 AND user_id=$3")
        .bind(folder)
        .bind(name(body.name)?)
        .bind(user)
        .execute(&state.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn remove(
    State(state): State<AppState>,
    UserId(user): UserId,
    Path(folder): Path<Uuid>,
) -> ApiResult<StatusCode> {
    own_folder(&state, user, folder).await?;
    sqlx::query("DELETE FROM image_folders WHERE id=$1 AND user_id=$2")
        .bind(folder)
        .bind(user)
        .execute(&state.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize)]
struct Move {
    ids: Vec<Uuid>,
    folder_id: Option<Uuid>,
}
async fn move_images(
    State(state): State<AppState>,
    UserId(user): UserId,
    Json(body): Json<Move>,
) -> ApiResult<StatusCode> {
    if body.ids.is_empty() || body.ids.len() > 2000 {
        return Err(ApiError(StatusCode::BAD_REQUEST, "select 1–2000 images"));
    }
    if let Some(folder) = body.folder_id {
        own_folder(&state, user, folder).await?;
    }
    let mut tx = state.pool.begin().await?;
    let rows = sqlx::query("UPDATE images SET folder_id=$3 WHERE user_id=$1 AND id=ANY($2)")
        .bind(user)
        .bind(&body.ids)
        .bind(body.folder_id)
        .execute(&mut *tx)
        .await?;
    let count = body
        .ids
        .iter()
        .collect::<std::collections::HashSet<_>>()
        .len();
    if rows.rows_affected() != count as u64 {
        return Err(ApiError(StatusCode::NOT_FOUND, "image not found"));
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/folders", get(list).post(create))
        .route("/api/folders/{id}", put(rename).delete(remove))
        .route("/api/images/folder", put(move_images))
}
