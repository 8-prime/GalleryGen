using GallerGen.Web.Settings;
using Microsoft.Extensions.Options;

namespace GallerGen.Web.BackgroundServices;

public class FileWatcherService(IOptions<GalleryGenSettings> options) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var settings = options.Value; 
        if(!Directory.Exists(settings.IngestPath)) throw new DirectoryNotFoundException("Ingest directory could not be found.");
        using var watcher = new FileSystemWatcher(settings.IngestPath);

        return Task.CompletedTask;
    }
}