namespace GalleryGen.Web.Extensions;

public static class ListExtensions
{
    private static readonly Random Rng = new Random();  
    public static List<List<T>> ChunkBySize<T>(this List<T> source, int chunkSize)
    {
        ArgumentNullException.ThrowIfNull(source);

        if (chunkSize <= 0)
            throw new ArgumentException("Chunk size must be greater than 0.", nameof(chunkSize));

        var result = new List<List<T>>();
        
        if (source.Count == 0)
            return result;
            
        var totalItems = source.Count;
        var fullChunks = totalItems / chunkSize;
        var remainingItems = totalItems % chunkSize;
        
        for (var i = 0; i < fullChunks; i++)
        {
            var chunk = source
                .Skip(i * chunkSize)
                .Take(chunkSize)
                .ToList();
            result.Add(chunk);
        }
        
        if (remainingItems <= 0) return result;
        
        var lastChunk = source
            .Skip(fullChunks * chunkSize)
            .Take(remainingItems)
            .ToList();
        result.Add(lastChunk);

        return result;
    }
    
    public static void Shuffle<T>(this IList<T> list)  
    {  
        var n = list.Count;  
        while (n > 1) {  
            n--;  
            var k = Rng.Next(n + 1);  
            (list[k], list[n]) = (list[n], list[k]);
        }  
    }
}
