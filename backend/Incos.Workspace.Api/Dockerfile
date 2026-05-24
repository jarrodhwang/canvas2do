FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS base
WORKDIR /app
EXPOSE 6272

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY ["backend/Incos.Workspace.Api/Incos.Workspace.Api.csproj", "backend/Incos.Workspace.Api/"]
RUN dotnet restore "backend/Incos.Workspace.Api/Incos.Workspace.Api.csproj"
COPY . .
WORKDIR "/src/backend/Incos.Workspace.Api"
RUN dotnet publish "Incos.Workspace.Api.csproj" -c Release -o /app/publish /p:UseAppHost=false

FROM base AS final
WORKDIR /app
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "Incos.Workspace.Api.dll"]
