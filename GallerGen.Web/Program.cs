using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.UseStaticFiles();
app.UseFileServer(new FileServerOptions
{
    FileProvider = new PhysicalFileProvider(@"C:\Users\hoffm\Desktop\galleryTest"), //TODO switch this to be set by config
    RequestPath = "",
    EnableDirectoryBrowsing = false
});

app.Run();