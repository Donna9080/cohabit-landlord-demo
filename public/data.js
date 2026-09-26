/*
  coHabit — SAMPLE DATA
  ------------------------------------
  Everything here is FICTIONAL. It is sample content only.

  How to edit:
  - Change any text between the quote marks, then save and redeploy (see README.md).
  - "id" becomes the page address, e.g. id "14-elm-street" → /properties/14-elm-street.
    Use lowercase letters, numbers and dashes only, and keep each id different.
  - "status" must be exactly "All clear" or "Lease ending soon".
  - The number of tenants on the dashboard is counted automatically from the list.
  - To add a property or tenant, copy an existing { ... } block, paste it after a
    comma, and edit it. Keep the commas between blocks.
*/
window.COHABIT_DATA = {
  properties: [
    {
      id: "14-elm-street",
      address: "14 Elm Street",
      city: "Waltham, MA 02453",
      leaseEnd: "Aug 31, 2027",
      status: "All clear",
      tenants: [
        { name: "Maya Chen", room: "Room 1", email: "maya.chen@example.com", phone: "(617) 555-0111" },
        { name: "Jordan Alvarez", room: "Room 2", email: "jordan.alvarez@example.com", phone: "(617) 555-0112" },
        { name: "Priya Nair", room: "Room 3", email: "priya.nair@example.com", phone: "(617) 555-0113" },
        { name: "Sam O'Connor", room: "Room 4", email: "sam.oconnor@example.com", phone: "(617) 555-0114" },
      ],
    },
    {
      id: "7-linden-street",
      address: "7 Linden Street",
      city: "Waltham, MA 02452",
      leaseEnd: "May 31, 2027",
      status: "All clear",
      tenants: [
        { name: "Ethan Brooks", room: "Room A", email: "ethan.brooks@example.com", phone: "(617) 555-0121" },
        { name: "Lina Haddad", room: "Room B", email: "lina.haddad@example.com", phone: "(617) 555-0122" },
        { name: "Noah Kim", room: "Room C", email: "noah.kim@example.com", phone: "(617) 555-0123" },
      ],
    },
    {
      id: "22-oak-avenue-unit-2",
      address: "22 Oak Avenue, Unit 2",
      city: "Waltham, MA 02451",
      leaseEnd: "Nov 14, 2026",
      status: "Lease ending soon",
      tenants: [
        { name: "Ava Thompson", room: "Room 1", email: "ava.thompson@example.com", phone: "(617) 555-0141" },
        { name: "Diego Morales", room: "Room 2", email: "diego.morales@example.com", phone: "(617) 555-0142" },
        { name: "Grace Liu", room: "Room 3", email: "grace.liu@example.com", phone: "(617) 555-0143" },
      ],
    },
  ],
};
