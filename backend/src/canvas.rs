use crate::auth::{ApiError, ApiResult, AppState, UserId};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::put,
};
use serde::Deserialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize)]
pub struct Frame {
    id: Uuid,
    image_id: Uuid,
    canvas_x: f64,
    canvas_y: f64,
    canvas_width: f64,
    canvas_height: f64,
    image_fit: String,
    position_x: f64,
    position_y: f64,
    sort_order: i32,
}
impl Frame {
    fn valid(&self) -> bool {
        [
            self.canvas_x,
            self.canvas_y,
            self.canvas_width,
            self.canvas_height,
            self.position_x,
            self.position_y,
        ]
        .iter()
        .all(|v| v.is_finite())
            && self.canvas_x >= 0.0
            && self.canvas_y >= 0.0
            && self.canvas_width >= 20.0
            && self.canvas_height >= 20.0
            && self.canvas_x + self.canvas_width <= 1200.0
            && self.canvas_y + self.canvas_height <= 100000.0
            && (0.0..=100.0).contains(&self.position_x)
            && (0.0..=100.0).contains(&self.position_y)
            && matches!(self.image_fit.as_str(), "cover" | "contain")
            && self.sort_order >= 0
    }
}
#[derive(Deserialize)]
struct Layout {
    items: Vec<Frame>,
}
async fn save(
    State(state): State<AppState>,
    UserId(user): UserId,
    Path(params): Path<HashMap<String, String>>,
    Json(body): Json<Layout>,
) -> ApiResult<Json<Value>> {
    let page = crate::portfolios::page(&state, user, &params).await?;
    let ids: HashSet<_> = body.items.iter().map(|i| i.id).collect();
    let orders: HashSet<_> = body.items.iter().map(|i| i.sort_order).collect();
    if body.items.len() > 2000
        || ids.len() != body.items.len()
        || orders.len() != body.items.len()
        || body.items.iter().any(|i| !i.valid())
    {
        return Err(ApiError(StatusCode::BAD_REQUEST, "invalid canvas layout"));
    }
    let mut tx = state.pool.begin().await?;
    sqlx::query("SELECT id FROM pages WHERE id=$1 FOR UPDATE")
        .bind(page)
        .execute(&mut *tx)
        .await?;
    let existing: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM grid_items WHERE page_id=$1")
        .bind(page)
        .fetch_all(&mut *tx)
        .await?;
    if existing.len() != ids.len() || existing.iter().any(|id| !ids.contains(id)) {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "page changed; reload before saving",
        ));
    }
    for item in body.items {
        let owned: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM images WHERE id=$1 AND user_id=$2)")
                .bind(item.image_id)
                .bind(user)
                .fetch_one(&mut *tx)
                .await?;
        if !owned {
            return Err(ApiError(StatusCode::NOT_FOUND, "image not found"));
        }
        sqlx::query("UPDATE grid_items SET image_id=$3,canvas_x=$4,canvas_y=$5,canvas_width=$6,canvas_height=$7,image_fit=$8,position_x=$9,position_y=$10,sort_order=$11 WHERE id=$1 AND page_id=$2")
            .bind(item.id).bind(page).bind(item.image_id).bind(item.canvas_x).bind(item.canvas_y).bind(item.canvas_width).bind(item.canvas_height)
            .bind(item.image_fit).bind(item.position_x).bind(item.position_y).bind(item.sort_order).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(serde_json::json!(
        crate::portfolios::items(&state, page).await?
    )))
}
pub fn routes() -> Router<AppState> {
    Router::new().route("/api/portfolios/{id}/pages/{pageId}/layout", put(save))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_frames_cannot_escape_the_page_or_inject_css() {
        let mut frame = Frame {
            id: Uuid::nil(),
            image_id: Uuid::nil(),
            canvas_x: 0.0,
            canvas_y: 4000.0,
            canvas_width: 400.0,
            canvas_height: 300.0,
            image_fit: "contain".into(),
            position_x: 50.0,
            position_y: 50.0,
            sort_order: 0,
        };
        assert!(frame.valid());
        frame.canvas_x = 900.0;
        assert!(!frame.valid());
        frame.canvas_x = 0.0;
        frame.image_fit = "cover; color:red".into();
        assert!(!frame.valid());
        frame.image_fit = "cover".into();
        frame.canvas_y = f64::NAN;
        assert!(!frame.valid());
    }
}
