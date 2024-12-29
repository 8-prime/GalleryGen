using BlazorTemplater;
using GallerGen.Web.Components;
using GallerGen.Web.Extensions;
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
            List<CollectionInfo> collectionInfos = [];
            foreach (var dir in dirs)
            {
                collectionInfos.Add(await ProcessDirectoryAsync(dir, stoppingToken));
            }
            var collectionNames = collectionInfos.Select(x => x.CollectionName).Distinct().ToList();
            var randomImage = collectionInfos[Random.Shared.Next(0, collectionInfos.Count)].ImageGroups[0].Images.FirstOrDefault();
            
            var landingHtml = new ComponentRenderer<LandingPage>()
                .Set(c => c.Collections, collectionNames)
                .Set(c => c.RandomImage, randomImage)
                .Set(c => c.Name, _settings.Name)
                .Render();
            
            var landingPath = Path.Combine(_settings.EgestPath, "index.html");
            await File.WriteAllTextAsync(landingPath, landingHtml, stoppingToken);

            foreach (var collection in collectionInfos)
            {
                var detail = new ComponentRenderer<CollectionPage>()
                    .Set(c => c.Collection, collection)
                    .Set(c => c.Collections, collectionNames)
                    .Set(c => c.Name, _settings.Name)
                    .Render();
                await File.WriteAllTextAsync(Path.Join(_settings.EgestPath, collection.CollectionName, "index.html"), detail, stoppingToken);
            }
        }
    }

    private async Task<CollectionInfo> ProcessDirectoryAsync(string directoryPath, CancellationToken stoppingToken)
    {
        var egestDir =  Path.Join(_settings.EgestPath, new DirectoryInfo(directoryPath).Name);
        if (!Directory.Exists(egestDir))
        {
            Directory.CreateDirectory(egestDir);
        }
        
        var typedImages = new Dictionary<ImageGroupType, List<string>>();
        
        var ingestFiles = Directory.GetFiles(directoryPath)
            .Where(file => 
                file.ToLowerInvariant().EndsWith(".jpg") || 
                file.ToLowerInvariant().EndsWith(".png") || 
                file.ToLowerInvariant().EndsWith(".jpeg"));
        foreach (var file in ingestFiles)
        {
            await ConvertAndSaveFile(egestDir, file, typedImages, stoppingToken);
        }

        var info = new CollectionInfo
        {
            CollectionName = new DirectoryInfo(directoryPath).Name,
            ImageGroups = []
        };
        
        foreach (var type in typedImages.Keys)
        {
            var grouped = typedImages[type].ChunkBySize(ImageGroupSizes.Sizes[type]);
            foreach (var group in grouped)
            {
                info.ImageGroups.Add(new ImageGroup
                {
                    Images = group,
                    Type = type,
                });        
            }
        }
        info.ImageGroups.Shuffle();
        return info;
    }

    private async Task ConvertAndSaveFile(string directoryPath, string file,
        Dictionary<ImageGroupType, List<string>> typedImages, CancellationToken stoppingToken)
    {
        using var image = await Image.LoadAsync(file, stoppingToken);
        var outputPath = Path.ChangeExtension(Path.Join(directoryPath, Path.GetFileName(file)), "webp");
        await image.SaveAsync(outputPath, new WebpEncoder()
        {
            Quality = 80,
            FileFormat = WebpFileFormatType.Lossy,
        }, cancellationToken: stoppingToken);
        var aspect = (float)image.Width / (float)image.Height;
        var htmlImagePath = Path.Join(directoryPath, Path.GetFileName(outputPath));
        switch (aspect)
        {
            case > 1.9f:
            {
                if (!typedImages.TryGetValue(ImageGroupType.Panorama, out var images))
                {
                    images = [];
                    typedImages.Add(ImageGroupType.Panorama, images);
                }
                images.Add(htmlImagePath);
                break;
            }
            case < 1.0f:
            {
                if (!typedImages.TryGetValue(ImageGroupType.Portrait, out var images))
                {
                    images = [];
                    typedImages.Add(ImageGroupType.Portrait, images);
                }
                images.Add(htmlImagePath);
                break;
            }
            default:
            {
                if (!typedImages.TryGetValue(ImageGroupType.Landscape, out var images))
                {
                    images = [];
                    typedImages.Add(ImageGroupType.Landscape, images);
                }
                images.Add(htmlImagePath);
                break;
            }
        }
    }
}
