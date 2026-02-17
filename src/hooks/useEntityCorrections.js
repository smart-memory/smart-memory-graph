import { useState, useEffect, useRef } from 'react';
import { searchWikipedia } from '../core/wikipedia';

/**
 * Entity correction logic extracted from DetailPanel (R3).
 * Handles type changes, label renames, and Wikipedia grounding.
 *
 * @param {Object} options
 * @param {Object} options.node - Selected node data
 * @param {Object} options.adapter - GraphAPIAdapter for API calls
 * @param {function} options.onNodeUpdate - Callback to update node in graph: (nodeId, updates) => void
 */
export function useEntityCorrections({ node, adapter, onNodeUpdate }) {
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const [customType, setCustomType] = useState('');
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState('');
  const [typeSaved, setTypeSaved] = useState(false);
  const [labelSaved, setLabelSaved] = useState(false);

  // Grounding state
  const [grounding, setGrounding] = useState(null);
  const [groundingLoading, setGroundingLoading] = useState(false);
  const [wikiResults, setWikiResults] = useState(null);
  const [wikiLoading, setWikiLoading] = useState(false);
  const [showWikiOverlay, setShowWikiOverlay] = useState(false);

  const labelInputRef = useRef(null);
  const nodeId = node?.id;

  // Reset state when the selected node changes
  useEffect(() => {
    setTypeDropdownOpen(false);
    setEditingLabel(false);
    setTypeSaved(false);
    setLabelSaved(false);
    setGrounding(null);
    setShowWikiOverlay(false);
    setWikiResults(null);
  }, [nodeId]);

  // Fetch grounding status on node change
  useEffect(() => {
    if (!nodeId || !adapter) return;
    let cancelled = false;
    setGroundingLoading(true);
    adapter.getGroundingStatus(nodeId)
      .then((data) => { if (!cancelled) setGrounding(data); })
      .catch(() => { if (!cancelled) setGrounding({ grounded: false, wikipedia: null }); })
      .finally(() => { if (!cancelled) setGroundingLoading(false); });
    return () => { cancelled = true; };
  }, [nodeId, adapter]);

  // Focus label input when editing starts
  useEffect(() => {
    if (editingLabel && labelInputRef.current) {
      labelInputRef.current.focus();
      labelInputRef.current.select();
    }
  }, [editingLabel]);

  async function handleTypeChange(newType) {
    setTypeDropdownOpen(false);
    setCustomType('');
    if (!newType || newType === node.type) return;
    const oldType = node.type;
    onNodeUpdate?.(node.id, { type: newType, entity_type: newType });
    setTypeSaved(true);
    setTimeout(() => setTypeSaved(false), 1500);
    try {
      await Promise.all([
        adapter.updateEntityNode(node.id, { entity_type: newType }),
        adapter.createOntologyPattern(node.label, newType, 1.0),
      ]);
    } catch (err) {
      console.error('Type update failed:', err);
      onNodeUpdate?.(node.id, { type: oldType, entity_type: oldType });
    }
  }

  async function handleLabelSave() {
    setEditingLabel(false);
    const newLabel = labelValue.trim();
    if (!newLabel || newLabel === node.label) return;
    onNodeUpdate?.(node.id, { label: newLabel });
    setLabelSaved(true);
    setTimeout(() => setLabelSaved(false), 1500);
    try {
      await adapter.updateEntityNode(node.id, { label: newLabel });
      await adapter.createOntologyPattern(newLabel, node.type, 1.0);
    } catch (err) {
      console.error('Label rename failed:', err);
      onNodeUpdate?.(node.id, { label: node.label });
    }
  }

  async function handleGround() {
    setWikiLoading(true);
    setShowWikiOverlay(true);
    try {
      const results = await searchWikipedia(node.label);
      setWikiResults(Array.isArray(results) ? results : []);
    } catch (err) {
      console.error('Wikipedia search failed:', err);
      setWikiResults([]);
    } finally {
      setWikiLoading(false);
    }
  }

  async function handleUnground() {
    try {
      await adapter.removeGrounding(node.id);
      setGrounding({ grounded: false, wikipedia: null });
    } catch (err) {
      console.error('Unground failed:', err);
    }
  }

  async function handleGroundAccept(article) {
    setShowWikiOverlay(false);
    setGrounding({ grounded: true, wikipedia: article });
    if (article.suggested_type && article.suggested_type !== node.type) {
      await handleTypeChange(article.suggested_type);
    }
  }

  return {
    // State
    typeDropdownOpen, setTypeDropdownOpen,
    customType, setCustomType,
    editingLabel, setEditingLabel,
    labelValue, setLabelValue,
    typeSaved, labelSaved,
    grounding, groundingLoading,
    wikiResults, wikiLoading,
    showWikiOverlay, setShowWikiOverlay,
    labelInputRef,
    // Handlers
    handleTypeChange,
    handleLabelSave,
    handleGround,
    handleUnground,
    handleGroundAccept,
  };
}
