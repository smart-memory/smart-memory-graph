export default function CytoscapeCanvas({ setContainerRef, children }) {
  return (
    <div className="flex-1 relative">
      <div ref={setContainerRef} className="cytoscape-container absolute inset-0" />
      {children}
    </div>
  );
}
