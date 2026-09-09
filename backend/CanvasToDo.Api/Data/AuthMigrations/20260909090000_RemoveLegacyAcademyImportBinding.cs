using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CanvasToDo.Api.Data.AuthMigrations
{
    /// <inheritdoc />
    public partial class RemoveLegacyAcademyImportBinding : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_auth_user_tokens_LegacyAcademyAccount",
                table: "auth_user_tokens");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "UX_auth_user_tokens_LegacyAcademyAccount",
                table: "auth_user_tokens",
                columns: new[] { "LoginProvider", "Name", "Value" },
                unique: true,
                filter: "\"LoginProvider\" = 'CanvasToDo.LegacyAcademyImport' AND \"Name\" = 'LegacyAcademyAccountId' AND \"Value\" IS NOT NULL");
        }
    }
}
