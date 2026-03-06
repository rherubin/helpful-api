const express = require('express');
const { createAuthenticateToken } = require('../middleware/auth');

function createOrgCodeRoutes(orgCodeModel, userModel, authService, adminAuthService) {
  const router = express.Router();
  const authenticateToken = createAuthenticateToken(authService);

  // Middleware to check if user is admin
  const requireAdmin = async (req, res, next) => {
    try {
      // First check if it's a regular user token
      if (req.user && req.user.type === 'admin') {
        // This is already an admin token, proceed
        return next();
      }

      // Check if it's a regular user trying to access admin endpoints
      return res.status(403).json({
        error: 'Admin access required. This endpoint is only available to admin users.'
      });
    } catch (error) {
      console.error('Admin check error:', error.message);
      return res.status(500).json({ error: 'Authentication error' });
    }
  };

  // Create org code
  router.post('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const orgCodeData = req.body;

      const createdOrgCode = await orgCodeModel.createOrgCode(orgCodeData);

      res.status(201).json({
        message: 'Org code created successfully',
        org_code: createdOrgCode
      });
    } catch (error) {
      console.error('Create org code error:', error.message);
      if (error.message.includes('already exists')) {
        return res.status(400).json({ error: error.message });
      }
      if (error.message.includes('required')) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Failed to create org code' });
    }
  });

  // Get all org codes
  router.get('/', authenticateToken, async (req, res) => {
    try {
      const orgCodes = await orgCodeModel.getAllOrgCodes();

      res.status(200).json({
        message: 'Org codes retrieved successfully',
        org_codes: orgCodes
      });
    } catch (error) {
      console.error('Get org codes error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch org codes' });
    }
  });

  // Get org-code linkage audit logs (admin only)
  router.get('/audit/org-linkages', authenticateToken, requireAdmin, async (req, res) => {
    try {
      if (!userModel || typeof userModel.getOrgCodeLinkAuditLogs !== 'function') {
        return res.status(500).json({ error: 'Audit log service unavailable' });
      }

      const { user_id, limit, offset } = req.query;
      const auditLogs = await userModel.getOrgCodeLinkAuditLogs({
        userId: user_id || null,
        limit,
        offset
      });

      res.status(200).json({
        message: 'Org linkage audit logs retrieved successfully',
        audit_logs: auditLogs
      });
    } catch (error) {
      console.error('Get org linkage audit logs error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch org linkage audit logs' });
    }
  });

  // Get org code by ID
  router.get('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const orgCode = await orgCodeModel.getOrgCodeById(id);

      res.status(200).json({
        message: 'Org code retrieved successfully',
        org_code: orgCode
      });
    } catch (error) {
      console.error('Get org code error:', error.message);
      if (error.message === 'OrgCode not found') {
        return res.status(404).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Failed to fetch org code' });
    }
  });

  // Update org code
  router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const updateData = req.body;

      const updatedOrgCode = await orgCodeModel.updateOrgCode(id, updateData);

      res.status(200).json({
        message: 'Org code updated successfully',
        org_code: updatedOrgCode
      });
    } catch (error) {
      console.error('Update org code error:', error.message);
      if (error.message === 'OrgCode not found') {
        return res.status(404).json({ error: error.message });
      }
      if (error.message.includes('already exists')) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Failed to update org code' });
    }
  });

  // Delete org code
  router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      const result = await orgCodeModel.deleteOrgCode(id);

      res.status(200).json(result);
    } catch (error) {
      console.error('Delete org code error:', error.message);
      if (error.message === 'OrgCode not found') {
        return res.status(404).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Failed to delete org code' });
    }
  });

  return router;
}

module.exports = createOrgCodeRoutes;