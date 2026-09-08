namespace CanvasToDo.Api.Domain.Entities;

public sealed class UserSetting
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public string UserKey { get; set; } = string.Empty;
    public string SettingKey { get; set; } = string.Empty;
    public string SettingJson { get; set; } = "{}";
}
