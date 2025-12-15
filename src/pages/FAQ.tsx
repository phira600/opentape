import { Header } from "@/components/dashboard/Header";
import { CheckCircle2, XCircle, AlertCircle, Shield, Scale, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
export default function FAQ() {
  return <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center gap-3 mb-2">
          <Scale className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold">FAQ & Compliance Guide</h1>
        </div>
        <p className="text-lg text-muted-foreground mb-8">
          Understanding your rights to "Delayed Data" under EU Law.
        </p>
        
        <p className="text-sm text-muted-foreground italic mb-8 p-4 bg-muted/50 rounded-lg">
          Disclaimer: This guide is provided for informational purposes only and does not constitute legal advice. 
          Users are responsible for their own compliance with data source Terms of Service and applicable laws.
        </p>

        {/* What is Legal */}
        <Card className="mb-8 border-green-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-500">
              <CheckCircle2 className="h-5 w-5" />
              What is "Legal" to do?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h3 className="font-semibold mb-2">1. Is this data really free?</h3>
              <p className="text-muted-foreground">
                <strong className="text-foreground">Yes.</strong> Under <strong>Article 13(2) of MiFIR</strong> (Regulation (EU) No 600/2014), 
                trading venues (stock exchanges) in the EU are legally required to make pre-trade and post-trade data available to the public 
                <strong> free of charge</strong> 15 minutes after publication.
              </p>
            </div>

            <div>
              <h3 className="font-semibold mb-2">2. Can I use this for my business (Asset Management / Hedge Fund)?</h3>
              <p className="text-muted-foreground mb-2">
                <strong className="text-foreground">Yes.</strong> According to <strong>ESMA Guideline 17</strong>, the "free of charge" 
                obligation applies to <strong>all users</strong>, including professional customers and investment firms. You can download 
                this data and use it for:
              </p>
              <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
                <li>Internal risk calculations (VaR, stress testing)</li>
                <li>Portfolio valuation (NAV calculations)</li>
                <li>Backtesting trading strategies</li>
                <li>Internal display (viewing prices on your own screen)</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-2">3. Can I feed this data into my internal algorithms?</h3>
              <p className="text-muted-foreground">
                <strong className="text-foreground">Generally, Yes.</strong> Unlike real-time data, where exchanges charge heavy 
                "Non-Display Fees" for algorithmic use, <strong>delayed data</strong> is generally exempt from these fees 
                <em> provided it is used internally</em>. ESMA has stated that venues should not restrict the "internal" use of this free data.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* What is Illegal */}
        <Card className="mb-8 border-red-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-500">
              <XCircle className="h-5 w-5" />
              What is "Illegal" (or requires a license)?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h3 className="font-semibold mb-2">1. Can I sell this data to my clients?</h3>
              <p className="text-muted-foreground">
                <strong className="text-foreground">NO.</strong> This is considered <strong>"Redistribution."</strong> Even if the data is 
                delayed, you cannot act as a Data Vendor without a license. If you download the data and send it to a third party 
                (even for free), you are redistributing.
              </p>
            </div>

            <div>
              <h3 className="font-semibold mb-2">2. Can I build a public website that shows these charts?</h3>
              <p className="text-muted-foreground">
                <strong className="text-foreground">NO.</strong> This is also redistribution. Publicly displaying the data to the world 
                counts as "disseminating" the data. The "Free of Charge" right is for <em>your</em> access, not for you to broadcast to others.
              </p>
            </div>

            <div>
              <h3 className="font-semibold mb-2">3. Can I create a "Signal Service" and sell the signals?</h3>
              <p className="text-muted-foreground mb-2"><strong className="text-foreground">It depends.</strong></p>
              <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
                <li><strong className="text-green-500">Permitted:</strong> You use the data to make trading decisions for a fund you manage (where you charge a management fee). This is internal use.</li>
                <li><strong className="text-red-500">Prohibited:</strong> You create a specific product called "Market Signals" derived from this data and sell that specific product to subscribers. Venues may classify this as a "Value Added Service" sold to third parties.</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* Technical Compliance */}
        <Card className="mb-8 border-yellow-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-yellow-500">
              <Shield className="h-5 w-5" />
              Technical Compliance (Don't get blocked)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h3 className="font-semibold mb-2">1. Can the Exchange block my IP?</h3>
              <p className="text-muted-foreground mb-2">
                <strong className="text-foreground">Yes.</strong> While you have a <em>legal right</em> to the data, the Exchange has a 
                right to protect its servers. If you request data 100 times a second, they will block you for a 
                <strong> Denial of Service (DoS)</strong> or "Abusive Scraping."
              </p>
              <p className="text-muted-foreground">The Fix: Use the built-in rate limits in Art13OpenTape which scrapes about once every 1 minute per exchange and filetype.<strong>The Fix:</strong> Use the built-in rate limits in Art13OpenTape. Do not poll faster than once every 15-20 minutes per instrument.
              </p>
            </div>

            <div>
              <h3 className="font-semibold mb-2">2. Do I need to pay for a "Direct Connection"?</h3>
              <p className="text-muted-foreground">
                <strong className="text-foreground">No.</strong> Exchanges often charge thousands of euros for a high-speed API connection. 
                However, they must provide the delayed data via a "human-readable" channel (like a website) for free. Art13OpenTape 
                automates the reading of that free channel. You do not need the paid API.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Legal References */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Key Legal References
            </CardTitle>
            <p className="text-sm text-muted-foreground">If your compliance officer asks, show them these:</p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Authority</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Key Takeaway</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium">EU Law</TableCell>
                  <TableCell><strong>MiFIR Art. 13(1) & (2)</strong></TableCell>
                  <TableCell className="text-muted-foreground">Mandates that data must be made available to the public on a "Reasonable Commercial Basis" and <strong>free of charge</strong> after 15 minutes.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Regulator</TableCell>
                  <TableCell><strong>ESMA Guideline 17</strong></TableCell>
                  <TableCell className="text-muted-foreground">Clarifies that "free of charge" applies to <strong>all customers</strong> (retail & professional) and forbids charging for the data license itself.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Regulator</TableCell>
                  <TableCell><strong>ESMA Q&A 9 / Guideline 1553</strong></TableCell>
                  <TableCell className="text-muted-foreground">Clarifies that venues generally cannot charge for <strong>internal</strong> value-added services (like running your own risk models).</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Summary Checklist */}
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-primary" />
              Summary Checklist
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                <span>I am using data delayed by at least 15 minutes.</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                <span>I am using the data for my own / my firm's internal analysis.</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                <span>I am NOT re-selling the raw data.</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                <span>I am NOT publishing the data on a public website.</span>
              </li>
              <li className="flex items-center gap-2">
                <div className="h-5 w-5 border-2 border-muted-foreground rounded shrink-0" />
                <span>I am adhering to polite rate limits (not crashing their site).</span>
              </li>
            </ul>
            <p className="mt-4 text-sm text-muted-foreground italic">
              If you checked all the boxes, you are likely compliant.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>;
}