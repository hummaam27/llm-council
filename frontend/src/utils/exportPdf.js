/**
 * PDF Export utility for LLM Council conversations.
 * Handles very long chats by building the PDF page by page.
 */

import jsPDF from 'jspdf';

/**
 * Export a conversation to PDF.
 * @param {Object} conversation - The conversation object with messages
 * @param {string} title - Optional title for the PDF
 */
export async function exportConversationToPdf(conversation, title = 'LLM Council Conversation') {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - 2 * margin;
  const lineHeight = 5;
  const headerHeight = 20;
  
  let yPosition = margin;

  // Helper to add a new page if needed
  const checkPageBreak = (requiredSpace = lineHeight * 2) => {
    if (yPosition + requiredSpace > pageHeight - margin) {
      pdf.addPage();
      yPosition = margin;
      return true;
    }
    return false;
  };

  // Helper to add wrapped text
  const addWrappedText = (text, fontSize = 10, isBold = false, color = [0, 0, 0]) => {
    pdf.setFontSize(fontSize);
    pdf.setFont('helvetica', isBold ? 'bold' : 'normal');
    pdf.setTextColor(...color);
    
    // Split text into lines that fit within content width
    const lines = pdf.splitTextToSize(text, contentWidth);
    
    for (const line of lines) {
      checkPageBreak();
      pdf.text(line, margin, yPosition);
      yPosition += lineHeight * (fontSize / 10);
    }
  };

  // Helper to add a section header
  const addSectionHeader = (text, fontSize = 12) => {
    checkPageBreak(lineHeight * 3);
    yPosition += lineHeight;
    addWrappedText(text, fontSize, true, [51, 51, 51]);
    yPosition += lineHeight * 0.5;
  };

  // Helper to add a horizontal line
  const addHorizontalLine = () => {
    checkPageBreak();
    pdf.setDrawColor(200, 200, 200);
    pdf.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += lineHeight;
  };

  // Title
  pdf.setFontSize(18);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(33, 33, 33);
  pdf.text(title, margin, yPosition);
  yPosition += headerHeight;

  // Metadata
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(100, 100, 100);
  const exportDate = new Date().toLocaleString();
  pdf.text(`Exported: ${exportDate}`, margin, yPosition);
  yPosition += lineHeight;
  
  if (conversation.id) {
    pdf.text(`Conversation ID: ${conversation.id}`, margin, yPosition);
    yPosition += lineHeight;
  }
  
  yPosition += lineHeight;
  addHorizontalLine();

  // Process each message
  for (let i = 0; i < conversation.messages.length; i++) {
    const msg = conversation.messages[i];
    
    if (msg.role === 'user') {
      // User message
      addSectionHeader('USER QUERY', 11);
      addWrappedText(msg.content, 10, false, [0, 0, 0]);
      yPosition += lineHeight;
      addHorizontalLine();
    } else {
      // Assistant message (council response)
      addSectionHeader('LLM COUNCIL RESPONSE', 11);
      
      // Stage 1: Individual Responses
      if (msg.stage1 && msg.stage1.length > 0) {
        addSectionHeader('Stage 1: Individual Responses', 11);
        
        for (const response of msg.stage1) {
          checkPageBreak(lineHeight * 4);
          
          // Model name
          const modelName = response.model.split('/')[1] || response.model;
          addWrappedText(`Model: ${modelName}`, 10, true, [0, 102, 204]);
          yPosition += lineHeight * 0.3;
          
          // Response content - strip markdown for cleaner PDF
          const cleanContent = stripMarkdown(response.response);
          addWrappedText(cleanContent, 9, false, [50, 50, 50]);
          yPosition += lineHeight;
        }
      }
      
      // Stage 2: Peer Rankings
      if (msg.stage2 && msg.stage2.length > 0) {
        addSectionHeader('Stage 2: Peer Rankings', 11);
        
        const labelToModel = msg.metadata?.label_to_model || {};
        
        for (const ranking of msg.stage2) {
          checkPageBreak(lineHeight * 4);
          
          // Evaluator model name
          const modelName = ranking.model.split('/')[1] || ranking.model;
          addWrappedText(`Evaluator: ${modelName}`, 10, true, [153, 51, 153]);
          yPosition += lineHeight * 0.3;
          
          // De-anonymize and clean the ranking text
          let rankingText = ranking.ranking;
          Object.entries(labelToModel).forEach(([label, model]) => {
            const shortName = model.split('/')[1] || model;
            rankingText = rankingText.replace(new RegExp(label, 'g'), shortName);
          });
          
          const cleanRanking = stripMarkdown(rankingText);
          addWrappedText(cleanRanking, 9, false, [50, 50, 50]);
          yPosition += lineHeight;
          
          // Parsed ranking if available
          if (ranking.parsed_ranking && ranking.parsed_ranking.length > 0) {
            addWrappedText('Final Ranking:', 9, true, [80, 80, 80]);
            ranking.parsed_ranking.forEach((label, idx) => {
              const modelForLabel = labelToModel[label];
              const displayName = modelForLabel 
                ? (modelForLabel.split('/')[1] || modelForLabel)
                : label;
              addWrappedText(`  ${idx + 1}. ${displayName}`, 9, false, [80, 80, 80]);
            });
            yPosition += lineHeight * 0.5;
          }
        }
        
        // Aggregate rankings
        if (msg.metadata?.aggregate_rankings && msg.metadata.aggregate_rankings.length > 0) {
          addSectionHeader('Aggregate Rankings (Street Cred)', 10);
          
          msg.metadata.aggregate_rankings.forEach((agg, idx) => {
            const modelName = agg.model.split('/')[1] || agg.model;
            addWrappedText(
              `#${idx + 1} ${modelName} - Avg: ${agg.average_rank.toFixed(2)} (${agg.rankings_count} votes)`,
              9, false, [60, 60, 60]
            );
          });
          yPosition += lineHeight;
        }
      }
      
      // Stage 3: Final Answer
      if (msg.stage3) {
        addSectionHeader('Stage 3: Final Council Answer', 11);
        
        const chairmanName = msg.stage3.model.split('/')[1] || msg.stage3.model;
        addWrappedText(`Chairman: ${chairmanName}`, 10, true, [0, 128, 0]);
        yPosition += lineHeight * 0.3;
        
        const cleanFinal = stripMarkdown(msg.stage3.response);
        addWrappedText(cleanFinal, 10, false, [0, 0, 0]);
        yPosition += lineHeight;
      }
      
      addHorizontalLine();
    }
  }

  // Footer on last page
  const totalPages = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(150, 150, 150);
    pdf.text(
      `Page ${i} of ${totalPages}`,
      pageWidth / 2,
      pageHeight - 8,
      { align: 'center' }
    );
  }

  // Generate filename
  const timestamp = new Date().toISOString().slice(0, 10);
  const safeTitle = (conversation.title || 'conversation')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .slice(0, 30);
  const filename = `LLM_Council_${safeTitle}_${timestamp}.pdf`;

  // Save the PDF
  pdf.save(filename);
}

/**
 * Strip markdown formatting for cleaner PDF text.
 * @param {string} text - Markdown text
 * @returns {string} - Plain text
 */
function stripMarkdown(text) {
  if (!text) return '';
  
  return text
    // Remove headers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Remove inline code
    .replace(/`([^`]+)`/g, '$1')
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '[code block]')
    // Remove links but keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove images
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '[image: $1]')
    // Remove blockquotes
    .replace(/^>\s+/gm, '')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}$/gm, '---')
    // Clean up extra whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
