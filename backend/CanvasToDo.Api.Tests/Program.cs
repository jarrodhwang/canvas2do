// Run with: dotnet run --project backend/CanvasToDo.Api.Tests
// All upstream traffic is handled in memory; no account or live Canvas is used.
using System.Net;
using System.Security.Claims;
using System.Text.Json;
using CanvasToDo.Api.Contracts;
using CanvasToDo.Api.Data;
using CanvasToDo.Api.Domain.Entities;
using CanvasToDo.Api.Endpoints;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;

var builder = WebApplication.CreateBuilder();
await using var app = builder.Build();
app.MapCanvasIntegrationEndpoints();

foreach (var scenario in new[] { "healthy", "fallback", "empty-fallback", "partial-batch", "denied", "rate-limited" })
{
    using var factory = new FakeCanvasFactory(scenario);
    using var cache = new MemoryCache(new MemoryCacheOptions());
    await using var db = new CanvasToDoDbContext(new DbContextOptionsBuilder<CanvasToDoDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
    var protection = new EphemeralDataProtectionProvider();
    var userId = Guid.NewGuid();
    var owner = $"user:{userId:D}";
    db.UserSettings.Add(new UserSetting
    {
        UserKey = owner,
        SettingKey = "canvas.token",
        SettingJson = JsonSerializer.Serialize(new
        {
            instanceUrl = "https://sfu.instructure.com",
            protectedAccessToken = protection.CreateProtector("incos.workspace.canvas-token.v1").Protect("test-token"),
            tokenSource = "user"
        })
    });
    await db.SaveChangesAsync();
    using var services = new ServiceCollection().AddSingleton<IHttpClientFactory>(factory).BuildServiceProvider();
    var context = new DefaultHttpContext
    {
        RequestServices = services,
        User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "test"))
    };
    context.Request.Headers["X-Canvas-To-Do-Owner-Key"] = owner;
    var response = await CanvasIntegrationEndpoints.GetCanvasCalendarItemsAsync(
        factory, context, db, app.Configuration, protection, cache,
        "2026-09-01", "2026-09-30", 100, false, CancellationToken.None);
    var expectedStatus = scenario == "denied" ? 409 : scenario == "rate-limited" ? 429 : 200;
    Check((response as IStatusCodeHttpResult)?.StatusCode == expectedStatus, $"{scenario}: response status");
    if (response is IValueHttpResult { Value: CanvasCalendarItemsDto calendar })
    {
        Check(calendar.IsComplete == (scenario == "healthy"), $"{scenario}: completeness");
        if (scenario is "fallback" or "partial-batch")
            Check(calendar.Items.Length > 0, $"{scenario}: preserve working data source");
        if (scenario == "empty-fallback")
            Check(calendar.Items.Length == 0, "Successful empty assignment response remains usable");
        if (scenario == "partial-batch")
            Check(calendar.Items.Any(item => item.Title == "Available class"), "Successful batches survive another batch's failure");
    }
    else if (response is IValueHttpResult { Value: ProblemDetails problem })
    {
        Check(problem.Detail?.Contains(scenario == "denied" ? "token" : "slow down") == true,
            $"{scenario}: retain actionable upstream error");
    }
    Check(factory.AssignmentRequests > 0, $"{scenario}: course assignments must be attempted");
    Console.WriteLine($"PASS {scenario}");
}

static void Check(bool condition, string description)
{
    if (!condition) throw new InvalidOperationException(description);
}

sealed class FakeCanvasFactory(string scenario) : HttpMessageHandler, IHttpClientFactory
{
    private int assignmentRequests;
    public int AssignmentRequests => assignmentRequests;
    public HttpClient CreateClient(string name) => new(this, disposeHandler: false);

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var uri = request.RequestUri!;
        object payload = Array.Empty<object>();
        var status = HttpStatusCode.OK;
        if (uri.AbsolutePath == "/api/v1/courses")
            payload = Enumerable.Range(1, 11).Select(id => new { id, name = $"Course {id}", course_code = $"TEST {id}", workflow_state = "available" }).ToArray();
        else if (uri.AbsolutePath == "/api/v1/calendar_events")
        {
            if (scenario == "partial-batch" && !Uri.UnescapeDataString(uri.Query).Contains("course_11"))
                payload = new[] { new { id = "working-event", title = "Available class", context_code = "course_1", start_at = "2026-09-10T09:00:00Z", end_at = "2026-09-10T10:00:00Z" } };
            else if (scenario != "healthy") status = FailureStatus();
        }
        else if (uri.AbsolutePath.EndsWith("/assignments"))
        {
            Interlocked.Increment(ref assignmentRequests);
            if (scenario == "fallback")
                payload = new[] { new { id = 42, name = "Available coursework", due_at = "2026-09-10T17:00:00Z", published = true, submission_types = new[] { "online_upload" } } };
            else if (scenario is not ("healthy" or "empty-fallback")) status = FailureStatus();
        }
        else if (!uri.AbsolutePath.Contains("/submissions"))
            throw new InvalidOperationException($"Unexpected upstream request: {uri.AbsolutePath}");
        return Task.FromResult(new HttpResponseMessage(status)
        {
            RequestMessage = request,
            Content = new StringContent(JsonSerializer.Serialize(payload))
        });
    }

    private HttpStatusCode FailureStatus() => scenario switch
    {
        "denied" => HttpStatusCode.Forbidden,
        "rate-limited" => HttpStatusCode.TooManyRequests,
        _ => HttpStatusCode.InternalServerError
    };
}
