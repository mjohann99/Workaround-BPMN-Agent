import {
  EmployeeView
} from "./employee/EmployeeView";

import {
  OwnerView
} from "./owner/OwnerView";

export default function App():
  JSX.Element {
  const pathname =
    window.location.pathname;

  const isOwnerView =
    pathname.startsWith(
      "/owner"
    );

  if (isOwnerView) {
    return <OwnerView />;
  }

  return <EmployeeView />;
}