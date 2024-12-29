using GallerGen.Web.Models;
using GallerGen.Web.Services;
using GallerGen.Web.Settings;
using Microsoft.Extensions.Options;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Webp;

namespace GallerGen.Web.BackgroundServices;

public class IngestProcessor(ProcessRequestService processRequestService, IOptions<GalleryGenSettings> settings)
    : BackgroundService
{
    private readonly GalleryGenSettings _settings = settings.Value;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if(!Directory.Exists(_settings.IngestPath)) throw new DirectoryNotFoundException("Ingest directory could not be found.");
        if (!Directory.Exists(_settings.EgestPath))
        {
            Directory.CreateDirectory(_settings.EgestPath);
        }
        
        var reader = processRequestService.GetProcessRequests();
        while (!stoppingToken.IsCancellationRequested)
        {
            await reader.ReadAsync(stoppingToken);
            var dirs = Directory.GetDirectories(_settings.IngestPath);
        }
    }

    private async Task ProcessDirectoryAsync(string directoryPath, CancellationToken stoppingToken)
    {
        var egestDir =  Path.Join(_settings.EgestPath, Path.GetDirectoryName(directoryPath));
        if (!Directory.Exists(egestDir))
        {
            Directory.CreateDirectory(egestDir);
        }
        
        var groups = new List<ImageGroup>();
        
        var ingestFiles = Directory.GetFiles(directoryPath).Where(file => file.ToLowerInvariant().EndsWith(".jpg") || file.ToLowerInvariant().EndsWith(".png") || file.ToLowerInvariant().EndsWith(".jpeg"));
        foreach (var file in ingestFiles)
        {
            using var image = await Image.LoadAsync(file, stoppingToken);
            var outputPath = Path.Join(_settings.EgestPath, Path.GetDirectoryName(directoryPath), Path.GetFileNameWithoutExtension(file), ".webp");
            await image.SaveAsync(outputPath, new WebpEncoder()
            {
                Quality = 80,
                FileFormat = WebpFileFormatType.Lossy,
            }, cancellationToken: stoppingToken);
        }
    }
}
