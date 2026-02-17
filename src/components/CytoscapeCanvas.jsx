export default function CytoscapeCanvas({ setContainerRef }) {
  return (
    <div className="flex-1 relative">
      <div ref={setContainerRef} className="cytoscape-container absolute inset-0" />
    </div>
  );
}
