namespace GalleryGen.Web.Models;

public static class ImageGroupSizes
{
    public static Dictionary<ImageGroupType, int> Sizes = new()
    {
        { ImageGroupType.Landscape, 3 },
        { ImageGroupType.Portrait, 2 },
        { ImageGroupType.Panorama, 1 },
    };
}