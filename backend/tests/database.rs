use gallerygen_backend::db;

/// Run against a dedicated disposable database, never a deployed database:
/// GALLERYGEN_TEST_DATABASE_URL=postgres://... cargo test --test database -- --ignored
#[tokio::test]
#[ignore = "requires GALLERYGEN_TEST_DATABASE_URL pointing to an isolated PostgreSQL database"]
async fn migrations_preserve_goose_history_and_existing_data() {
    let url =
        std::env::var("GALLERYGEN_TEST_DATABASE_URL").expect("isolated test database URL required");
    let pool = db::connect(&url).await.unwrap();
    let tables: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(tables, 0, "test requires an empty disposable database");
    db::migrate(&pool).await.unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM goose_db_version")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 10);
    let id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO users (email) VALUES ('migration-test@example.invalid') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    db::migrate(&pool).await.unwrap();
    let preserved: uuid::Uuid =
        sqlx::query_scalar("SELECT id FROM users WHERE email = 'migration-test@example.invalid'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(id, preserved);
    let after: i64 = sqlx::query_scalar("SELECT count(*) FROM goose_db_version")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(after, count);
    let permissions: (bool, bool) = sqlx::query_as(
        "SELECT can_create_portfolio, can_publish_portfolio FROM users WHERE id = $1",
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(permissions, (false, false));
    verify_canvas_and_folders(&pool, id).await;
    sqlx::query("INSERT INTO goose_db_version (version_id, is_applied) VALUES (999, true)")
        .execute(&pool)
        .await
        .unwrap();
    assert!(db::migrate(&pool).await.is_err());
    pool.close().await;
}

async fn verify_canvas_and_folders(pool: &sqlx::PgPool, user: uuid::Uuid) {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use gallerygen_backend::{application, auth::AppState};
    use serde_json::json;
    use tower::ServiceExt;
    let other: uuid::Uuid =
        sqlx::query_scalar("INSERT INTO users(email) VALUES('other@example.invalid') RETURNING id")
            .fetch_one(pool)
            .await
            .unwrap();
    let portfolio: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO portfolios(user_id,slug,title) VALUES($1,'canvas-test','Canvas') RETURNING id",
    )
    .bind(user)
    .fetch_one(pool)
    .await
    .unwrap();
    let page:uuid::Uuid=sqlx::query_scalar("INSERT INTO pages(portfolio_id,type,slug,title) VALUES($1,'main','main','Main') RETURNING id").bind(portfolio).fetch_one(pool).await.unwrap();
    let image:uuid::Uuid=sqlx::query_scalar("INSERT INTO images(user_id,storage_key,filename,mime_type) VALUES($1,'test/photo.jpg','photo.jpg','image/jpeg') RETURNING id").bind(user).fetch_one(pool).await.unwrap();
    let foreign:uuid::Uuid=sqlx::query_scalar("INSERT INTO images(user_id,storage_key,filename,mime_type) VALUES($1,'other/photo.jpg','other.jpg','image/jpeg') RETURNING id").bind(other).fetch_one(pool).await.unwrap();
    let mut ids = Vec::<uuid::Uuid>::new();
    for order in 0..2 {
        ids.push(sqlx::query_scalar("INSERT INTO grid_items(page_id,image_id,col_start,row_start,sort_order) VALUES($1,$2,1,1,$3) RETURNING id").bind(page).bind(image).bind(order).fetch_one(pool).await.unwrap());
    }
    let secret = "integration-test-secret";
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let token = jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &json!({"user_id":user,"iat":now,"exp":now+600}),
        &jsonwebtoken::EncodingKey::from_secret(secret.as_bytes()),
    )
    .unwrap();
    let app = application(
        std::path::Path::new("/nonexistent"),
        AppState {
            pool: pool.clone(),
            jwt_secret: secret.into(),
            storage_path: "/nonexistent".into(),
            image_signer: None,
        },
        None,
    );
    let frame = |id: uuid::Uuid, image_id: uuid::Uuid, x: f64, order: i32| json!({"id":id,"image_id":image_id,"canvas_x":x,"canvas_y":1500,"canvas_width":400,"canvas_height":300,"image_fit":"contain","position_x":25,"position_y":75,"sort_order":order});
    let request = |method: &str, path: String, body: serde_json::Value| {
        Request::builder()
            .method(method)
            .uri(path)
            .header("authorization", format!("Bearer {token}"))
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap()
    };
    let path = format!("/api/portfolios/{portfolio}/pages/{page}/layout");
    let response = app
        .clone()
        .oneshot(request(
            "PUT",
            path.clone(),
            json!({"items":[frame(ids[0],image,42.0,0),frame(ids[1],image,500.0,1)]}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let saved: (f64, String) =
        sqlx::query_as("SELECT canvas_x,image_fit FROM grid_items WHERE id=$1")
            .bind(ids[0])
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(saved, (42.0, "contain".into()));
    let response = app
        .clone()
        .oneshot(request(
            "PUT",
            path.clone(),
            json!({"items":[frame(ids[0],image,70.0,0),frame(ids[1],foreign,500.0,1)]}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let x: f64 = sqlx::query_scalar("SELECT canvas_x FROM grid_items WHERE id=$1")
        .bind(ids[0])
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(x, 42.0, "failed replacement must roll back earlier writes");
    let response = app
        .clone()
        .oneshot(request(
            "PUT",
            path,
            json!({"items":[frame(ids[0],image,42.0,0)]}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let folder: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO image_folders(user_id,name) VALUES($1,'Travel') RETURNING id",
    )
    .bind(user)
    .fetch_one(pool)
    .await
    .unwrap();
    let response = app
        .clone()
        .oneshot(request(
            "PUT",
            "/api/images/folder".into(),
            json!({"ids":[image,foreign],"folder_id":folder}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let assigned: Option<uuid::Uuid> =
        sqlx::query_scalar("SELECT folder_id FROM images WHERE id=$1")
            .bind(image)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(assigned, None);
    let response = app
        .clone()
        .oneshot(request(
            "PUT",
            "/api/images/folder".into(),
            json!({"ids":[image],"folder_id":folder}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let response = app
        .oneshot(request(
            "DELETE",
            format!("/api/folders/{folder}"),
            json!({}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let assigned: Option<uuid::Uuid> =
        sqlx::query_scalar("SELECT folder_id FROM images WHERE id=$1")
            .bind(image)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(assigned, None);
    let placements: i64 = sqlx::query_scalar("SELECT count(*) FROM grid_items WHERE page_id=$1")
        .bind(page)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(placements, 2);
}
