// src/models/App.js
const mongoose = require('mongoose');

const LinkSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ['help']
  },
  url: {
    type: String,
    required: true
  }
  // When creating documents with links, MongoDB won't generate ObjectIds for array elements. The array indices (0, 1, 2, etc.) will serve as natural identifiers.
}, { _id: false, id: false });

const InteractionSchema = new mongoose.Schema({
  name: String,
  description: String,
  type: {
    type: String,
    enum: ['trigger', 'action'],
    required: false
  }
}, { _id: false });

const AppSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  description: {
    type: String,
    maxLength: 512
  },
  logo_url: String,
  links: [LinkSchema],
  interactions: [InteractionSchema],
  category: String,
  isRelevant: {
    type: Boolean,
    default: null
  },
  relevancyReasoning: String,
  potentialUseCase: String,
  scrapedAt: Date,
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('App', AppSchema);