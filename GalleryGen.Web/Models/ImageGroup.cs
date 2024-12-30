namespace GalleryGen.Web.Models;

public class ImageGroup
{
    public ImageGroupType Type { get; set; }
    public List<string> Images { get; set; } = [];
}