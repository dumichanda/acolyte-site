// Business details shown on the site. Fill these in before launch.
// Empty values are simply hidden — nothing made-up is ever shown.
export const SITE = {
  name: "Acolyte",
  legalName: "",          // registered company name, e.g. "Acolyte (Pty) Ltd"
  regNumber: "",          // CIPC registration number
  email: "",              // public contact email
  phone: "",              // public phone / WhatsApp number
  city: "",               // e.g. "Johannesburg"
  informationOfficer: "", // POPIA Information Officer name (often a director)
  // Contact form endpoint. Free: sign up at formspree.io, create a form, paste its URL, e.g. "https://formspree.io/f/abcdwxyz".
  formEndpoint: "",
  // Acolyte Analyst API (analyst/server.py), e.g. "https://acolyte-site.onrender.com". Empty = page shows setup note.
  analystApi: "https://acolyte-site.onrender.com",
};

/** Site-relative link that works at the domain root or under a sub-path such as /acolyte-site/. */
export const url = (path: string) => import.meta.env.BASE_URL + path.replace(/^\//, "");
