using GalleryGen.Web.BackgroundServices;
using GalleryGen.Web.Services;
using GalleryGen.Web.Settings;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<GalleryGenSettings>(builder.Configuration.GetSection("GalleryGen"));
builder.Services.AddHostedService<FileWatcherService>();
builder.Services.AddHostedService<IngestProcessor>();
builder.Services.AddSingleton<ProcessRequestService>();

var app = builder.Build();

app.UseStaticFiles();
app.UseFileServer(new FileServerOptions
{
    FileProvider = new PhysicalFileProvider(app.Services.GetRequiredService<IOptions<GalleryGenSettings>>().Value.EgestPath), //TODO switch this to be set by config
    RequestPath = "",
    EnableDirectoryBrowsing = false
});


var sv = app.Services.GetRequiredService<ProcessRequestService>();
await sv.TriggerProcessing();

await app.RunAsync();