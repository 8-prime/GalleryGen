use crate::{
    auth::{ApiError, ApiResult, AppState, UserId},
    images::image_url,
};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::get,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Row, postgres::PgRow};
use std::collections::HashMap;
use uuid::Uuid;

type Params = Path<HashMap<String, String>>;
fn id(params: &HashMap<String, String>, key: &str) -> ApiResult<Uuid> {
    params
        .get(key)
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or(ApiError(
            StatusCode::BAD_REQUEST,
            match key {
                "id" => "invalid portfolio id",
                "pageId" => "invalid page id",
                _ => "invalid item id",
            },
        ))
}
fn not_found() -> ApiError {
    ApiError(StatusCode::NOT_FOUND, "not found")
}
fn parse_json(text: String) -> ApiResult<Value> {
    serde_json::from_str(&text)
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "internal error"))
}
fn slugify(title: &str) -> String {
    title
        .to_lowercase()
        .split(|c: char| !c.is_ascii_lowercase() && !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}
async fn own(state: &AppState, user: Uuid, portfolio: Uuid) -> ApiResult<()> {
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM portfolios WHERE id=$1 AND user_id=$2)")
            .bind(portfolio)
            .bind(user)
            .fetch_one(&state.pool)
            .await?;
    if !exists {
        return Err(not_found());
    }
    Ok(())
}
async fn page(state: &AppState, user: Uuid, params: &HashMap<String, String>) -> ApiResult<Uuid> {
    let portfolio = id(params, "id")?;
    own(state, user, portfolio).await?;
    if params.contains_key("pageId") {
        let page =
            id(params, "pageId").map_err(|_| ApiError(StatusCode::NOT_FOUND, "page not found"))?;
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM pages WHERE id=$1 AND portfolio_id=$2)",
        )
        .bind(page)
        .bind(portfolio)
        .fetch_one(&state.pool)
        .await?;
        if !exists {
            return Err(ApiError(StatusCode::NOT_FOUND, "page not found"));
        }
        return Ok(page);
    }
    let mut tx = state.pool.begin().await?;
    // Lock the parent before lazy main-page creation; the legacy schema has no
    // unique constraint on page type and concurrent requests must not duplicate it.
    sqlx::query("SELECT id FROM portfolios WHERE id=$1 FOR UPDATE")
        .bind(portfolio)
        .execute(&mut *tx)
        .await?;
    let found: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM pages WHERE portfolio_id=$1 AND type='main' LIMIT 1")
            .bind(portfolio)
            .fetch_optional(&mut *tx)
            .await?;
    let page = match found { Some(page)=>page, None=>sqlx::query_scalar("INSERT INTO pages(portfolio_id,type,slug,title,sort_order) VALUES ($1,'main','main','Main',0) RETURNING id").bind(portfolio).fetch_one(&mut *tx).await? };
    tx.commit().await?;
    Ok(page)
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct PortfolioBody {
    title: String,
    slug: String,
    description: Option<String>,
    published: bool,
    gap_px: i32,
    matte_px: i32,
}
impl PortfolioBody {
    fn normalize(&mut self) -> ApiResult<()> {
        if self.title.is_empty() {
            return Err(ApiError(StatusCode::BAD_REQUEST, "title is required"));
        }
        if self.slug.is_empty() {
            self.slug = slugify(&self.title);
        }
        self.gap_px = self.gap_px.max(0);
        self.matte_px = self.matte_px.max(0);
        Ok(())
    }
}
async fn list(State(state): State<AppState>, UserId(user): UserId) -> ApiResult<Json<Value>> {
    let rows: Vec<String> = sqlx::query_scalar(
        "SELECT row_to_json(p)::text FROM portfolios p WHERE user_id=$1 ORDER BY created_at DESC",
    )
    .bind(user)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(Value::Array(
        rows.into_iter().map(parse_json).collect::<ApiResult<_>>()?,
    )))
}
async fn create(
    State(state): State<AppState>,
    UserId(user): UserId,
    Json(mut body): Json<PortfolioBody>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let allowed: bool = sqlx::query_scalar("SELECT can_create_portfolio FROM users WHERE id=$1")
        .bind(user)
        .fetch_one(&state.pool)
        .await?;
    if !allowed {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "not permitted to create portfolios",
        ));
    }
    body.normalize()?;
    let row: String = sqlx::query_scalar("INSERT INTO portfolios AS p (user_id,slug,title,description,gap_px,matte_px) VALUES ($1,$2,$3,$4,$5,$6) RETURNING row_to_json(p)::text")
        .bind(user).bind(body.slug).bind(body.title).bind(body.description).bind(body.gap_px).bind(body.matte_px).fetch_one(&state.pool).await?;
    Ok((StatusCode::CREATED, Json(parse_json(row)?)))
}
async fn update(
    State(state): State<AppState>,
    UserId(user): UserId,
    Path(params): Params,
    Json(mut body): Json<PortfolioBody>,
) -> ApiResult<Json<Value>> {
    let portfolio = id(&params, "id")?;
    if body.published {
        let allowed: bool =
            sqlx::query_scalar("SELECT can_publish_portfolio FROM users WHERE id=$1")
                .bind(user)
                .fetch_one(&state.pool)
                .await?;
        if !allowed {
            return Err(ApiError(
                StatusCode::FORBIDDEN,
                "not permitted to publish portfolios",
            ));
        }
    }
    body.normalize()?;
    let row:Option<String>=sqlx::query_scalar("UPDATE portfolios AS p SET slug=$3,title=$4,description=$5,published=$6,gap_px=$7,matte_px=$8 WHERE id=$1 AND user_id=$2 RETURNING row_to_json(p)::text")
        .bind(portfolio).bind(user).bind(body.slug).bind(body.title).bind(body.description).bind(body.published).bind(body.gap_px).bind(body.matte_px).fetch_optional(&state.pool).await?;
    Ok(Json(parse_json(row.ok_or_else(not_found)?)?))
}
async fn remove(
    State(state): State<AppState>,
    UserId(user): UserId,
    Path(params): Params,
) -> ApiResult<StatusCode> {
    sqlx::query("DELETE FROM portfolios WHERE id=$1 AND user_id=$2")
        .bind(id(&params, "id")?)
        .bind(user)
        .execute(&state.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct PageBody {
    title: String,
    slug: String,
    sort_order: i32,
}
impl PageBody {
    fn normalize(&mut self) -> ApiResult<()> {
        if self.title.is_empty() {
            return Err(ApiError(StatusCode::BAD_REQUEST, "title is required"));
        }
        if self.slug.is_empty() {
            self.slug = slugify(&self.title);
        }
        Ok(())
    }
}
async fn list_pages(
    State(state): State<AppState>,
    UserId(user): UserId,
    Path(params): Params,
) -> ApiResult<Json<Value>> {
    let portfolio = id(&params, "id")?;
    own(&state, user, portfolio).await?;
    let rows: Vec<String> = sqlx::query_scalar(
        "SELECT row_to_json(p)::text FROM pages p WHERE portfolio_id=$1 ORDER BY sort_order",
    )
    .bind(portfolio)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(Value::Array(
        rows.into_iter().map(parse_json).collect::<ApiResult<_>>()?,
    )))
}
async fn create_page(
    State(state): State<AppState>,
    UserId(user): UserId,
    Path(params): Params,
    Json(mut body): Json<PageBody>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let portfolio = id(&params, "id")?;
    own(&state, user, portfolio).await?;
    body.normalize()?;
    let row:String=sqlx::query_scalar("INSERT INTO pages AS p (portfolio_id,type,slug,title,sort_order) VALUES ($1,'category',$2,$3,$4) RETURNING row_to_json(p)::text")
        .bind(portfolio).bind(body.slug).bind(body.title).bind(body.sort_order).fetch_one(&state.pool).await?;
    Ok((StatusCode::CREATED, Json(parse_json(row)?)))
}
async fn update_page(
    State(state): State<AppState>,
    UserId(user): UserId,
    Path(params): Params,
    Json(mut body): Json<PageBody>,
) -> ApiResult<Json<Value>> {
    let portfolio = id(&params, "id")?;
    own(&state, user, portfolio).await?;
    let page = id(&params, "pageId")?;
    body.normalize()?;
    let row:Option<String>=sqlx::query_scalar("UPDATE pages AS p SET slug=$3,title=$4,sort_order=$5 WHERE id=$1 AND portfolio_id=$2 RETURNING row_to_json(p)::text")
        .bind(page).bind(portfolio).bind(body.slug).bind(body.title).bind(body.sort_order).fetch_optional(&state.pool).await?;
    Ok(Json(parse_json(row.ok_or_else(not_found)?)?))
}
async fn remove_page(
    State(state): State<AppState>,
    UserId(user): UserId,
    Path(params): Params,
) -> ApiResult<StatusCode> {
    let portfolio = id(&params, "id")?;
    own(&state, user, portfolio).await?;
    sqlx::query("DELETE FROM pages WHERE id=$1 AND portfolio_id=$2")
        .bind(id(&params, "pageId")?)
        .bind(portfolio)
        .execute(&state.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

const ITEMS: &str = "SELECT gi.*,i.storage_key,i.filename,i.mime_type,i.width,i.height FROM grid_items gi JOIN images i ON i.id=gi.image_id WHERE gi.page_id=$1 ORDER BY gi.sort_order";
fn item_response(state: &AppState, row: PgRow) -> Value {
    let image: Uuid = row.get("image_id");
    let key: String = row.get("storage_key");
    json!({"id":row.get::<Uuid,_>("id"),"image_id":image,"sort_order":row.get::<i32,_>("sort_order"),
        "col_start":row.get::<i32,_>("col_start"),"row_start":row.get::<i32,_>("row_start"),"col_span":row.get::<i32,_>("col_span"),"row_span":row.get::<i32,_>("row_span"),
        "row_break_before":row.get::<bool,_>("row_break_before"),"filename":row.get::<String,_>("filename"),"mime_type":row.get::<String,_>("mime_type"),
        "width":row.get::<Option<i32>,_>("width").unwrap_or(0),"height":row.get::<Option<i32>,_>("height").unwrap_or(0),
        "thumb_url":image_url(state,image,&key,true),"full_url":image_url(state,image,&key,false)})
}
async fn items(state: &AppState, page: Uuid) -> ApiResult<Vec<Value>> {
    Ok(sqlx::query(ITEMS)
        .bind(page)
        .fetch_all(&state.pool)
        .await?
        .into_iter()
        .map(|row| item_response(state, row))
        .collect())
}
async fn list_items(
    State(state): State<AppState>,
    UserId(user): UserId,
    Path(params): Params,
) -> ApiResult<Json<Value>> {
    let page = page(&state, user, &params).await?;
    Ok(Json(json!(items(&state, page).await?)))
}
#[derive(Deserialize)]
struct AddBody {
    image_id: String,
}
async fn add_item(
    State(state): State<AppState>,
    UserId(user): UserId,
    Path(params): Params,
    Json(body): Json<AddBody>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let page = page(&state, user, &params).await?;
    let image = Uuid::parse_str(&body.image_id)
        .map_err(|_| ApiError(StatusCode::BAD_REQUEST, "invalid image id"))?;
    let mut tx = state.pool.begin().await?;
    sqlx::query("SELECT id FROM pages WHERE id=$1 FOR UPDATE")
        .bind(page)
        .execute(&mut *tx)
        .await?;
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM images WHERE id=$1 AND user_id=$2)")
            .bind(image)
            .bind(user)
            .fetch_one(&mut *tx)
            .await?;
    if !exists {
        return Err(ApiError(StatusCode::NOT_FOUND, "image not found"));
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM grid_items WHERE page_id=$1")
        .bind(page)
        .fetch_one(&mut *tx)
        .await?;
    let item:Uuid=sqlx::query_scalar("INSERT INTO grid_items(page_id,image_id,col_start,row_start,sort_order) VALUES($1,$2,1,$3,$4) RETURNING id")
        .bind(page).bind(image).bind(count as i32+1).bind(count as i32).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    let result = items(&state, page)
        .await?
        .into_iter()
        .find(|value| value["id"] == item.to_string())
        .ok_or_else(not_found)?;
    Ok((StatusCode::CREATED, Json(result)))
}
async fn remove_item(
    State(state): State<AppState>,
    UserId(user): UserId,
    Path(params): Params,
) -> ApiResult<StatusCode> {
    let page = page(&state, user, &params).await?;
    sqlx::query("DELETE FROM grid_items WHERE id=$1 AND page_id=$2")
        .bind(id(&params, "itemId")?)
        .bind(page)
        .execute(&state.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Default, Deserialize)]
#[serde(default)]
struct Layout {
    col_span: i32,
    row_span: i32,
    row_break_before: bool,
}
async fn layout(
    State(state): State<AppState>,
    UserId(user): UserId,
    Path(params): Params,
    Json(body): Json<Layout>,
) -> ApiResult<Json<Value>> {
    let page = page(&state, user, &params).await?;
    let item = id(&params, "itemId")?;
    let changed=sqlx::query("UPDATE grid_items SET col_span=$3,row_span=$4,row_break_before=$5 WHERE id=$1 AND page_id=$2")
        .bind(item).bind(page).bind(body.col_span.max(1)).bind(body.row_span.max(1)).bind(body.row_break_before).execute(&state.pool).await?;
    if changed.rows_affected() == 0 {
        return Err(not_found());
    }
    Ok(Json(
        items(&state, page)
            .await?
            .into_iter()
            .find(|value| value["id"] == item.to_string())
            .ok_or_else(not_found)?,
    ))
}
#[derive(Default, Deserialize)]
#[serde(default)]
struct Reorder {
    ids: Vec<String>,
}
async fn reorder(
    State(state): State<AppState>,
    UserId(user): UserId,
    Path(params): Params,
    Json(body): Json<Reorder>,
) -> ApiResult<StatusCode> {
    let page = page(&state, user, &params).await?;
    let ids = body
        .ids
        .iter()
        .map(|id| {
            Uuid::parse_str(id).map_err(|_| ApiError(StatusCode::BAD_REQUEST, "invalid item id"))
        })
        .collect::<ApiResult<Vec<_>>>()?;
    let mut tx = state.pool.begin().await?;
    sqlx::query("SELECT id FROM pages WHERE id=$1 FOR UPDATE")
        .bind(page)
        .execute(&mut *tx)
        .await?;
    for (order, item) in ids.into_iter().enumerate() {
        let changed = sqlx::query("UPDATE grid_items SET sort_order=$3 WHERE id=$1 AND page_id=$2")
            .bind(item)
            .bind(page)
            .bind(order as i32)
            .execute(&mut *tx)
            .await?;
        if changed.rows_affected() == 0 {
            return Err(not_found());
        }
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn public(State(state): State<AppState>, Path(params): Params) -> ApiResult<Json<Value>> {
    let slug = params.get("slug").ok_or_else(not_found)?;
    let portfolio: Option<(Uuid, String, Option<String>)> = sqlx::query_as(
        "SELECT id,title,description FROM portfolios WHERE slug=$1 AND published=true",
    )
    .bind(slug)
    .fetch_optional(&state.pool)
    .await?;
    let (portfolio, title, description) = portfolio.ok_or_else(not_found)?;
    let rows = sqlx::query(
        "SELECT id,title,slug,sort_order FROM pages WHERE portfolio_id=$1 ORDER BY sort_order",
    )
    .bind(portfolio)
    .fetch_all(&state.pool)
    .await?;
    let mut pages = Vec::new();
    for row in rows {
        let page: Uuid = row.get("id");
        let mut images = items(&state, page).await?;
        for image in &mut images {
            image["url"] = image["full_url"].clone();
            for key in ["full_url", "thumb_url", "row_break_before", "mime_type"] {
                image.as_object_mut().unwrap().remove(key);
            }
        }
        pages.push(json!({"id":page,"title":row.get::<String,_>("title"),"slug":row.get::<String,_>("slug"),"sort_order":row.get::<i32,_>("sort_order"),"images":images}));
    }
    Ok(Json(
        json!({"id":portfolio,"title":title,"description":description,"pages":pages}),
    ))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/portfolios", get(list).post(create))
        .route("/api/portfolios/", get(list).post(create))
        .route(
            "/api/portfolios/{id}",
            axum::routing::put(update).delete(remove),
        )
        .route(
            "/api/portfolios/{id}/pages",
            get(list_pages).post(create_page),
        )
        .route(
            "/api/portfolios/{id}/pages/{pageId}",
            axum::routing::put(update_page).delete(remove_page),
        )
        .route(
            "/api/portfolios/{id}/images",
            get(list_items).post(add_item),
        )
        .route(
            "/api/portfolios/{id}/images/{itemId}",
            axum::routing::delete(remove_item),
        )
        .route(
            "/api/portfolios/{id}/pages/{pageId}/images",
            get(list_items).post(add_item),
        )
        .route(
            "/api/portfolios/{id}/pages/{pageId}/images/{itemId}",
            axum::routing::delete(remove_item).patch(layout),
        )
        .route(
            "/api/portfolios/{id}/pages/{pageId}/images/reorder",
            axum::routing::post(reorder),
        )
        .route("/api/public/portfolios/{slug}", get(public))
        .route("/p/{slug}", get(public_html))
}

fn render_html(data: Value) -> ApiResult<String> {
    let mut env = minijinja::Environment::new();
    env.add_template(
        "portfolio.html",
        include_str!("../templates/portfolio.html"),
    )
    .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "template error"))?;
    env.get_template("portfolio.html")
        .and_then(|template| template.render(data))
        .map_err(|error| {
            tracing::error!(%error,"portfolio rendering failed");
            ApiError(StatusCode::INTERNAL_SERVER_ERROR, "template error")
        })
}

async fn public_html(
    State(state): State<AppState>,
    Path(params): Params,
) -> ApiResult<axum::response::Html<String>> {
    let Json(mut data) = public(State(state.clone()), Path(params)).await?;
    let portfolio =
        Uuid::parse_str(data["id"].as_str().ok_or_else(not_found)?).map_err(|_| not_found())?;
    let (gap, matte): (i32, i32) =
        sqlx::query_as("SELECT gap_px,matte_px FROM portfolios WHERE id=$1 AND published=true")
            .bind(portfolio)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(not_found)?;
    data["gap_px"] = json!(gap.max(0));
    data["matte_px"] = json!(matte.max(0));
    Ok(axum::response::Html(render_html(data)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_slug_rules() {
        assert_eq!(slugify("  My Photos / 2026! "), "my-photos-2026");
        assert_eq!(slugify("München"), "m-nchen");
    }

    #[test]
    fn public_html_escapes_content_and_handles_empty_portfolios() {
        let html=render_html(json!({"title":"<script>alert(1)</script>","description":"<b>text</b>","gap_px":4,"matte_px":0,"pages":[]})).unwrap();
        assert!(!html.contains("<script>alert(1)</script>"));
        assert!(html.contains("&lt;script&gt;"));
        assert!(html.contains("&lt;b&gt;text&lt;"));
        assert!(!html.contains("<b>text</b>"));
    }

    #[test]
    fn public_html_preserves_navigation_and_image_layout() {
        let html=render_html(json!({"title":"Portfolio","description":null,"gap_px":8,"matte_px":2,
            "pages":[{"slug":"main","title":"Main","images":[{"url":"/media/photo","filename":"a\" onerror=\"bad","col_span":2,"row_span":1}]},
                     {"slug":"travel","title":"Travel","images":[]}]})).unwrap();
        assert!(html.contains("grid-column:span 2;grid-row:span 1"));
        assert!(html.contains("data-page=\"travel\""));
        assert!(!html.contains("alt=\"a\" onerror="));
    }
}
