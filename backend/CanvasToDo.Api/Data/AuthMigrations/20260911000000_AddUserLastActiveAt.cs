using CanvasToDo.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace CanvasToDo.Api.Data.AuthMigrations;

[DbContext(typeof(AuthDbContext))]
[Migration("20260911000000_AddUserLastActiveAt")]
public sealed class AddUserLastActiveAt : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) =>
        migrationBuilder.AddColumn<DateTimeOffset>(
            name: "LastActiveAt", table: "auth_users",
            type: "timestamp with time zone", nullable: true);

    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.DropColumn(name: "LastActiveAt", table: "auth_users");
}
