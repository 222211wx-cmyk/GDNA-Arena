import { createContext, useContext, type ReactNode } from "react"

const PortalContainerContext = createContext<HTMLElement | undefined>(undefined)

/** Optional island container; ordinary consumers keep Radix's body portals. */
export function PortalContainerProvider({
  container,
  children,
}: {
  container: HTMLElement
  children: ReactNode
}) {
  return (
    <PortalContainerContext.Provider value={container}>
      {children}
    </PortalContainerContext.Provider>
  )
}

export function usePortalContainer() {
  return useContext(PortalContainerContext)
}