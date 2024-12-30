using System.Threading.Channels;

namespace GalleryGen.Web.Services;

public class ProcessRequestService
{
    private readonly Channel<bool> _requestChannel = Channel.CreateBounded<bool>(10);

    public ChannelReader<bool> GetProcessRequests()
    {
        return _requestChannel.Reader;
    }

    public async Task TriggerProcessing()
    {
        await _requestChannel.Writer.WaitToWriteAsync();
        await _requestChannel.Writer.WriteAsync(true);
    }
}