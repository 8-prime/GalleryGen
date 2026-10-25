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
    assert_eq!(count, 8);
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
    sqlx::query("INSERT INTO goose_db_version (version_id, is_applied) VALUES (999, true)")
        .execute(&pool)
        .await
        .unwrap();
    assert!(db::migrate(&pool).await.is_err());
    pool.close().await;
}
