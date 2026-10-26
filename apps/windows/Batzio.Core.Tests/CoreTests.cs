using System.Text.Json.Nodes;
using Batzio.Core;
using Batzio.Core.Api;
using Batzio.Core.Format;
using Batzio.Core.Localization;
using Batzio.Core.Models;
using Xunit;

public class CoreTests
{
    [Fact]
    public void ReadsRecordsLoosely()
    {
        var r = JsonNode.Parse("""{"id":12,"nr":"INV-1","total":1891.75,"paid":false,"contact_id":null}""")!.AsObject();
        Assert.Equal(12, r["id"].Int());
        Assert.Equal("12", r["id"].Str());
        Assert.Equal(1891.75, r["total"].Num());
        Assert.False(r["paid"].Bool());
        Assert.True(r["contact_id"].IsNull());
    }

    [Fact]
    public void FormatsSwissStyle()
    {
        Assert.Equal("1’234.50", Fmt.Amount(1234.5));
        Assert.Equal("CHF -42.00", Fmt.Money(-42));
        Assert.Equal("2:30 h", Fmt.Duration(150));
        Assert.Equal("25.10.2026", Fmt.Date("2026-10-25"));
    }

    [Fact]
    public void ParsesAgentStream()
    {
        Assert.Equal(new AgentEvent.Thread("t1"), AgentEvent.Parse("""{"type":"thread","threadId":"t1"}"""));
        Assert.Equal(new AgentEvent.Text("Grüezi"), AgentEvent.Parse("""{"type":"text","delta":"Grüezi"}"""));
        var tool = Assert.IsType<AgentEvent.Tool>(AgentEvent.Parse("""{"type":"tool","outcome":{"id":"tu1","tool":"create_invoice","title":"Invoice","ok":true,"record":{"resource":"invoices","id":3}}}"""));
        Assert.Equal(3, tool.Outcome.Record?.Id);
        Assert.Null(AgentEvent.Parse("""{"type":"mystery"}"""));
    }

    [Fact]
    public void UsesTheSharedCatalog()
    {
        Loc.Locale = "it";
        Assert.Equal("Oggi", Loc.L("Today"));
        Assert.Equal("3 voci", Loc.L("{n} records", ("n", 3)));
        Loc.Locale = "en";
        Assert.Equal("Today", Loc.L("Today"));
    }

    [Fact]
    public void DecodesBootstrap()
    {
        var json = """
        {"locale":"de","mode":"simple","tenant":{"id":"t","slug":"acme","name":"Acme","locale":"de-CH"},"role":"owner","permissions":{"sales":"write"},
         "navigation":[{"id":"overview","label":"","icon":"Sun","items":[{"title":"Heute","icon":"Sun","target":{"kind":"today"},"tabs":[]}]}],
         "resources":[{"name":"invoices","singular":"invoice","label":"Rechnung","labelPlural":"Rechnungen","description":"","icon":"Receipt","area":"sales",
           "fields":[{"name":"total","label":"Total","type":"money","list":true}],"view":"document","softDelete":false,"readOnly":false,"canWrite":true,"canCreate":true,"pdf":true,"future":1}],
         "reports":[],"glossary":{"vat":{"term":"MWST","text":"…"}},"agent":false,"inbox":null,"examples":["Hallo"]}
        """;
        var b = JsonNode.Parse(json).To<Bootstrap>()!;
        Assert.Equal("today", b.Navigation[0].Items[0].Target.Kind);
        Assert.Equal("money", b.Resource("invoices")!.ListFields.First().Type);
        Assert.True(b.Resource("invoices")!.IsDocument);
        Assert.Equal("MWST", b.Explain("vat")!.Term);
    }

    [Fact]
    public void BuildsRequests()
    {
        var api = new ApiClient("https://example.test/base/", "abc", "acme", "fr");
        var r = api.Request(HttpMethod.Get, "/api/v1/app/today", new Dictionary<string, string?> { ["mode"] = "simple", ["skip"] = null });
        Assert.Equal("https://example.test/base/api/v1/app/today?mode=simple&locale=fr", r.RequestUri!.ToString());
        Assert.Equal("Bearer abc", r.Headers.Authorization!.ToString());
        Assert.Equal("acme", r.Headers.GetValues("X-Tenant").Single());
    }

    [Fact]
    public void ReadsFieldsLikeTheWeb()
    {
        var money = new FieldDef("total", "Total", "money");
        Assert.Equal("1’891.75", FieldText.Text(money, JsonValue.Create(1891.75)));
        var status = new FieldDef("status", "Status", "enum", Options: [new FieldOption("open", "Offen", "info")]);
        Assert.Equal("Offen", FieldText.Text(status, JsonValue.Create("open")));
        var contact = new FieldDef("contact_id", "Kunde", "ref", Ref: "contacts");
        Assert.Equal("Muster AG", FieldText.Text(contact, JsonValue.Create(7), new Dictionary<string, Dictionary<string, string>> { ["contact_id"] = new() { ["7"] = "Muster AG" } }));
    }
}
