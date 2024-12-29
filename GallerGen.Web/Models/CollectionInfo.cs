namespace GallerGen.Web.Models;

public class CollectionInfo
{
    public required string CollectionName { get; set; }
    public List<ImageGroup> ImageGroups { get; set; } = [];
}