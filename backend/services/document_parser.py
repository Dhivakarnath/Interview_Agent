"""
Document parsing service for resumes (PDF and DOC/DOCX)
"""

import logging
import io
from typing import Optional
from PyPDF2 import PdfReader
from docx import Document

logger = logging.getLogger("document_parser")


class DocumentParser:
    """Parse PDF and DOC/DOCX documents to extract text"""
    
    @staticmethod
    def parse_pdf(file_content: bytes) -> Optional[str]:
        """Extract text from PDF file"""
        try:
            pdf_file = io.BytesIO(file_content)
            reader = PdfReader(pdf_file)
            text_parts = []
            
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    text_parts.append(text)
            
            return "\n\n".join(text_parts)
        except Exception as e:
            logger.error(f"Error parsing PDF: {e}")
            return None
    
    @staticmethod
    def parse_docx(file_content: bytes) -> Optional[str]:
        """Extract text from DOCX file"""
        try:
            doc_file = io.BytesIO(file_content)
            doc = Document(doc_file)
            text_parts = []
            
            for paragraph in doc.paragraphs:
                if paragraph.text.strip():
                    text_parts.append(paragraph.text)
            
            return "\n\n".join(text_parts)
        except Exception as e:
            logger.error(f"Error parsing DOCX: {e}")
            return None
    
    @staticmethod
    def parse_document(file_content: bytes, filename: str) -> Optional[str]:
        """Parse document based on file extension"""
        filename_lower = filename.lower()
        
        if filename_lower.endswith('.pdf'):
            return DocumentParser.parse_pdf(file_content)
        elif filename_lower.endswith(('.doc', '.docx')):
            return DocumentParser.parse_docx(file_content)
        else:
            logger.error(f"Unsupported file type: {filename}")
            return None

