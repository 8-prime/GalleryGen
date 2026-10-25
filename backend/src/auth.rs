use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    Json, Router,
    extract::{FromRequestParts, State},
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use uuid::Uuid;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub jwt_secret: String,
    pub storage_path: std::path::PathBuf,
    pub image_signer: Option<std::sync::Arc<crate::imgproxy::Signer>>,
}

#[derive(Debug)]
pub struct ApiError(pub StatusCode, pub &'static str);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error": self.1}))).into_response()
    }
}
impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        tracing::error!(%error, "database operation failed");
        Self(StatusCode::INTERNAL_SERVER_ERROR, "internal error")
    }
}
pub type ApiResult<T> = Result<T, ApiError>;

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    user_id: Uuid,
    exp: u64,
    iat: u64,
}

fn validate(token: &str, secret: &str) -> ApiResult<Claims> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.leeway = 0;
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map(|data| data.claims)
    .map_err(|_| ApiError(StatusCode::UNAUTHORIZED, "unauthorized"))
}

fn token_pair(id: Uuid, secret: &str) -> ApiResult<Json<Value>> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "internal error"))?
        .as_secs();
    let token = |ttl| {
        encode(
            &Header::new(Algorithm::HS256),
            &Claims {
                user_id: id,
                exp: now + ttl,
                iat: now,
            },
            &EncodingKey::from_secret(secret.as_bytes()),
        )
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "internal error"))
    };
    Ok(Json(
        json!({"access_token": token(900)?, "refresh_token": token(7 * 86400)?}),
    ))
}

pub struct UserId(pub Uuid);
impl FromRequestParts<AppState> for UserId {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> ApiResult<Self> {
        let token = parts
            .headers
            .get("authorization")
            .and_then(|h| h.to_str().ok())
            .and_then(|h| h.strip_prefix("Bearer "))
            .ok_or(ApiError(StatusCode::UNAUTHORIZED, "unauthorized"))?;
        Ok(Self(validate(token, &state.jwt_secret)?.user_id))
    }
}

#[derive(Deserialize)]
struct Credentials {
    #[serde(default)]
    email: String,
    #[serde(default)]
    password: String,
}

async fn register(
    State(state): State<AppState>,
    Json(body): Json<Credentials>,
) -> ApiResult<impl IntoResponse> {
    if body.email.is_empty() || body.password.is_empty() {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "email and password required",
        ));
    }
    // Reject passwords beyond bcrypt's 72-byte limit rather than truncating.
    if body.password.len() > 72 {
        return Err(ApiError(StatusCode::CONFLICT, "registration failed"));
    }
    let hash = tokio::task::spawn_blocking(move || bcrypt::hash(body.password, 12))
        .await
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "internal error"))?
        .map_err(|_| ApiError(StatusCode::CONFLICT, "registration failed"))?;
    let id: Uuid =
        sqlx::query_scalar("INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id")
            .bind(body.email)
            .bind(hash)
            .fetch_one(&state.pool)
            .await
            .map_err(|error| {
                tracing::warn!(%error, "registration failed");
                ApiError(StatusCode::CONFLICT, "registration failed")
            })?;
    Ok((StatusCode::CREATED, token_pair(id, &state.jwt_secret)?))
}

async fn login(
    State(state): State<AppState>,
    Json(body): Json<Credentials>,
) -> ApiResult<Json<Value>> {
    let row: Option<(Uuid, Option<String>)> =
        sqlx::query_as("SELECT id, password_hash FROM users WHERE email = $1")
            .bind(body.email)
            .fetch_optional(&state.pool)
            .await?;
    let (id, hash) = row
        .and_then(|(id, hash)| hash.map(|hash| (id, hash)))
        .ok_or(ApiError(StatusCode::UNAUTHORIZED, "invalid credentials"))?;
    let valid =
        tokio::task::spawn_blocking(move || bcrypt::verify(body.password, &hash).unwrap_or(false))
            .await
            .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "internal error"))?;
    if !valid {
        return Err(ApiError(StatusCode::UNAUTHORIZED, "invalid credentials"));
    }
    token_pair(id, &state.jwt_secret)
}

#[derive(Deserialize)]
struct Refresh {
    #[serde(default)]
    refresh_token: String,
}
async fn refresh(
    State(state): State<AppState>,
    Json(body): Json<Refresh>,
) -> ApiResult<Json<Value>> {
    if body.refresh_token.is_empty() {
        return Err(ApiError(StatusCode::BAD_REQUEST, "refresh_token required"));
    }
    let claims = validate(&body.refresh_token, &state.jwt_secret)
        .map_err(|_| ApiError(StatusCode::UNAUTHORIZED, "invalid refresh token"))?;
    token_pair(claims.user_id, &state.jwt_secret)
}

async fn me(State(state): State<AppState>, UserId(id): UserId) -> ApiResult<Json<Value>> {
    let row = sqlx::query("SELECT id, email, plan, is_admin, can_create_portfolio, can_publish_portfolio FROM users WHERE id = $1")
        .bind(id).fetch_one(&state.pool).await?;
    Ok(Json(json!({
        "id": row.get::<Uuid,_>("id"), "email": row.get::<String,_>("email"),
        "plan": row.get::<String,_>("plan"), "is_admin": row.get::<bool,_>("is_admin"),
        "can_create_portfolio": row.get::<bool,_>("can_create_portfolio"),
        "can_publish_portfolio": row.get::<bool,_>("can_publish_portfolio")
    })))
}

pub async fn bootstrap_admin(
    pool: &PgPool,
    email: Option<&str>,
    password: Option<&str>,
) -> anyhow::Result<()> {
    let (Some(email), Some(password)) = (email, password) else {
        return Ok(());
    };
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)")
        .bind(email)
        .fetch_one(pool)
        .await?;
    if !exists {
        anyhow::ensure!(
            password.len() <= 72,
            "ADMIN_PASSWORD exceeds bcrypt's 72-byte limit"
        );
        let password = password.to_owned();
        let hash = tokio::task::spawn_blocking(move || bcrypt::hash(password, 12)).await??;
        sqlx::query("INSERT INTO users (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING")
            .bind(email).bind(hash).execute(pool).await?;
    }
    sqlx::query("UPDATE users SET is_admin = true WHERE email = $1")
        .bind(email)
        .execute(pool)
        .await?;
    Ok(())
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/auth/register", post(register))
        .route("/api/auth/login", post(login))
        .route("/api/auth/refresh", post(refresh))
        .route("/api/auth/me", get(me))
        .route("/api/admin/users", get(list_users))
        .route(
            "/api/admin/users/{id}",
            axum::routing::patch(update_permissions),
        )
        .route("/api/auth/oauth/{provider}", get(oauth_stub))
        .route("/api/auth/oauth/{provider}/callback", get(oauth_stub))
}
async fn oauth_stub() -> ApiError {
    ApiError(StatusCode::NOT_IMPLEMENTED, "oauth not configured")
}

async fn require_admin(state: &AppState, id: Uuid) -> ApiResult<()> {
    let admin: Option<bool> = sqlx::query_scalar("SELECT is_admin FROM users WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;
    if admin != Some(true) {
        return Err(ApiError(StatusCode::FORBIDDEN, "forbidden"));
    }
    Ok(())
}

async fn list_users(State(state): State<AppState>, UserId(id): UserId) -> ApiResult<Json<Value>> {
    require_admin(&state, id).await?;
    let rows: Vec<String> = sqlx::query_scalar(
        "SELECT json_build_object(
        'id', id, 'email', email, 'plan', plan,
        'created_at', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),
        'is_admin', is_admin, 'can_create_portfolio', can_create_portfolio,
        'can_publish_portfolio', can_publish_portfolio)::text FROM users ORDER BY created_at DESC",
    )
    .fetch_all(&state.pool)
    .await?;
    let values: Vec<Value> = rows
        .iter()
        .map(|row| serde_json::from_str(row))
        .collect::<Result<_, _>>()
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "internal error"))?;
    Ok(Json(json!(values)))
}

#[derive(Deserialize)]
#[serde(default)]
#[derive(Default)]
struct Permissions {
    is_admin: bool,
    can_create_portfolio: bool,
    can_publish_portfolio: bool,
}
async fn update_permissions(
    State(state): State<AppState>,
    UserId(actor): UserId,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(body): Json<Permissions>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, actor).await?;
    let id =
        Uuid::parse_str(&id).map_err(|_| ApiError(StatusCode::BAD_REQUEST, "invalid user id"))?;
    let email: String = sqlx::query_scalar(
        "UPDATE users SET is_admin = $2, can_create_portfolio = $3,
        can_publish_portfolio = $4 WHERE id = $1 RETURNING email",
    )
    .bind(id)
    .bind(body.is_admin)
    .bind(body.can_create_portfolio)
    .bind(body.can_publish_portfolio)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(
        json!({"id": id, "email": email, "is_admin": body.is_admin,
        "can_create_portfolio": body.can_create_portfolio, "can_publish_portfolio": body.can_publish_portfolio}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;

    #[tokio::test]
    async fn protected_routes_reject_missing_credentials_without_database_access() {
        let state = AppState {
            pool: sqlx::postgres::PgPoolOptions::new()
                .connect_lazy("postgres://unused:unused@127.0.0.1:1/unused")
                .unwrap(),
            jwt_secret: "secret".into(),
            storage_path: "/nonexistent/gallerygen".into(),
            image_signer: None,
        };
        for path in ["/api/auth/me", "/api/admin/users"] {
            let response = routes()
                .with_state(state.clone())
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        }
    }
    #[test]
    fn tokens_preserve_legacy_claims_and_reject_wrong_secrets() {
        let id = Uuid::new_v4();
        let Json(pair) = token_pair(id, "test-secret").unwrap();
        let access = pair["access_token"].as_str().unwrap();
        assert_eq!(validate(access, "test-secret").unwrap().user_id, id);
        assert!(validate(access, "wrong-secret").is_err());
        let refresh = validate(pair["refresh_token"].as_str().unwrap(), "test-secret").unwrap();
        assert_eq!(refresh.exp - refresh.iat, 7 * 86400);
    }
    #[test]
    fn expired_tokens_are_rejected() {
        let token = encode(
            &Header::new(Algorithm::HS256),
            &Claims {
                user_id: Uuid::new_v4(),
                exp: 1,
                iat: 0,
            },
            &EncodingKey::from_secret(b"secret"),
        )
        .unwrap();
        assert!(validate(&token, "secret").is_err());
    }
}
