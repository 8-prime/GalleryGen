FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build-env
WORKDIR /App

# Copy everything
COPY . ./

# Restore as distinct layers
RUN dotnet restore ./GalleryGen.Web/GalleryGen.Web.csproj
# Build and publish a release

WORKDIR /App
RUN dotnet publish -c Release --os linux -o out ./GalleryGen.Web/GalleryGen.Web.csproj

# Build runtime image
FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /App
COPY --from=build-env /App/out .
ENTRYPOINT ["dotnet", "GalleryGen.Web.dll"]