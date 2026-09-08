FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS base
WORKDIR /app
EXPOSE 5000 6272

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY ["backend/CanvasToDo.Api/CanvasToDo.Api.csproj", "backend/CanvasToDo.Api/"]
RUN dotnet restore "backend/CanvasToDo.Api/CanvasToDo.Api.csproj"
COPY . .
WORKDIR "/src/backend/CanvasToDo.Api"
RUN dotnet publish "CanvasToDo.Api.csproj" -c Release -o /app/publish --no-restore \
    /p:UseAppHost=false /p:DebugType=None /p:DebugSymbols=false

FROM base AS final
LABEL org.opencontainers.image.title="Canvas To Do API" \
      org.opencontainers.image.description="Canvas To Do ASP.NET Core API"
WORKDIR /app
COPY --from=build /app/publish .
RUN mkdir -p /var/lib/canvas-to-do/data-protection-keys \
    && chown -R "$APP_UID:$APP_UID" /app /var/lib/canvas-to-do
USER $APP_UID
ENTRYPOINT ["dotnet", "CanvasToDo.Api.dll"]
