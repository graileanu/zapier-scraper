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
}, { _id: true });

const InteractionSchema = new mongoose.Schema({
  name: String,
  description: String
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
    maxLength: 255
  },
  logo_url: String,
  links: [LinkSchema],
  interactions: [InteractionSchema],
  category: String,
  scrapedAt: Date,
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('App', AppSchema);