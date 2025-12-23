import { SmartHeader } from "@/components/SmartHeader";

export default function TermsOfUse() {
  return (
    <div className="min-h-screen bg-background">
      <SmartHeader />
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <h1 className="text-3xl font-bold mb-8">Terms of Use and Liability Disclaimer</h1>
        
        <div className="prose prose-invert max-w-none space-y-6">
          <p className="text-muted-foreground">
            <strong>Product Name:</strong> opentape<br />
            <strong>License Type:</strong> Open Source (Recommended: MIT or Apache 2.0)
          </p>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">1. Preamble & Nature of Service</h2>
            <p className="text-muted-foreground">
              The Software is provided strictly as a technical utility to facilitate the retrieval of publicly available information.
            </p>
            <p className="text-muted-foreground">
              <strong>The Software is NOT a Data Provider:</strong> opentape does not host, cache, redistribute, or sub-license market data. It acts solely as a "User Agent" or "Connector" that enables the User to fetch data directly from third-party sources (Trading Venues/Exchanges) to the User's local system.
            </p>
            <p className="text-muted-foreground">
              <strong>No Commercial Link:</strong> The Developer of this Software has no commercial relationship with the data sources and does not charge fees for the data.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">2. User Responsibility & Compliance</h2>
            <p className="text-muted-foreground">By using this Software, you (the "User") acknowledge and agree that:</p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
              <li>
                <strong>Direct Relationship:</strong> The data download is a direct transaction between You and the Source (the Exchange). You are responsible for complying with the Source's Terms of Service.
              </li>
              <li>
                <strong>Regulatory Rights:</strong> You acknowledge that your right to access this data "free of charge" is based on Article 13(2) of MiFIR (Regulation (EU) No 600/2014) and ESMA Guidelines on Market Data, provided the data is delayed by at least 15 minutes.
              </li>
              <li>
                <strong>Internal Use Only:</strong> Unless you have a separate license with the Exchange, you agree to use the fetched data solely for internal business purposes or personal use. You must not redistribute, resell, or sub-license the raw data to third parties.
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">3. Prohibited Use Cases</h2>
            <p className="text-muted-foreground">The User agrees NOT to use the Software to:</p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
              <li>
                <strong>A.</strong> Bypass technical blocking measures (e.g., CAPTCHAs, IP bans) implemented by the data source.
              </li>
              <li>
                <strong>B.</strong> Engage in "High-Frequency Scraping" or Denial of Service (DoS) attacks that degrade the performance of the data source's servers.
              </li>
              <li>
                <strong>C.</strong> Download data for the purpose of creating a competing commercial data feed (Redistribution) without compensating the original source.
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">4. Disclaimer of Warranty ("As Is")</h2>
            <p className="text-muted-foreground uppercase text-sm">
              THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
