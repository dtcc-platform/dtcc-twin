import dtccLogo from "@/assets/dtcc-logo.svg";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const links = [
  { label: "Home", href: "https://www.dtcc.chalmers.se/" },
  { label: "About", href: "https://www.dtcc.chalmers.se/about/" },
  { label: "Projects", href: "https://www.dtcc.chalmers.se/projects/" },
  { label: "Gallery", href: "https://www.dtcc.chalmers.se/gallery/" },
  { label: "Partners", href: "https://www.dtcc.chalmers.se/partners/" },
  { label: "News", href: "https://www.dtcc.chalmers.se/news/" },
  { label: "Contact", href: "https://www.dtcc.chalmers.se/contact/" },
  { label: "Social", href: "https://www.linkedin.com/company/digital-twin-cities-centre/" },
  { label: "Platform", href: "https://github.com/dtcc-platform/dtcc" },
];

export function DtccMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="DTCC links"
        className="flex size-11 items-center justify-center rounded-full border bg-card shadow-md outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <img src={dtccLogo} alt="" className="size-7" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48">
        {links.map((link) => (
          <DropdownMenuLinkItem key={link.href} href={link.href} target="_blank" rel="noreferrer">
            {link.label}
          </DropdownMenuLinkItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
