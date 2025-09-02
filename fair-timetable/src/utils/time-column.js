/**
 * TimeColumn utility class for managing time slot blocks
 */

import { select } from '@wordpress/data';
import { parse, isAfter } from 'date-fns';

/**
 * TimeColumn class for managing time slots within a timetable
 */
export class TimeColumn {
	/**
	 * Constructor
	 *
	 * @param {string} parentId - The parent timetable block ID
	 */
	constructor(parentId) {
		this.parentId = parentId;
		this.allTimeSlots = [];
		this.loadTimeSlots();
	}

	/**
	 * Load all time slot blocks from the parent timetable
	 *
	 * @private
	 */
	loadTimeSlots() {
		if (!this.parentId) {
			this.allTimeSlots = [];
			return;
		}

		const { getBlocks, getBlock } = select('core/block-editor');

		try {
			const parentBlock = getBlock(this.parentId);
			if (!parentBlock) {
				this.allTimeSlots = [];
				return;
			}

			this.allTimeSlots = getBlocks(this.parentId).filter(
				(block) => block.name === 'fair-timetable/time-slot'
			);
		} catch (error) {
			console.warn('TimeColumn: Failed to load time slots:', error);
			this.allTimeSlots = [];
		}
	}

	/**
	 * Refresh time slots data
	 */
	refresh() {
		this.loadTimeSlots();
	}

	/**
	 * Get all time slots
	 *
	 * @return {Array} Array of time slot blocks
	 */
	getAllTimeSlots() {
		return this.allTimeSlots;
	}

	/**
	 * Get sibling time slots (excluding the specified clientId)
	 *
	 * @param {string} excludeClientId - Client ID to exclude from results
	 * @return {Array} Array of sibling time slot blocks
	 */
	getSiblingTimeSlots(excludeClientId) {
		return this.allTimeSlots.filter(
			(block) => block.clientId !== excludeClientId
		);
	}

	/**
	 * Get time slot by client ID
	 *
	 * @param {string} clientId - The client ID to find
	 * @return {Object|null} Time slot block or null if not found
	 */
	getTimeSlot(clientId) {
		return (
			this.allTimeSlots.find((block) => block.clientId === clientId) ||
			null
		);
	}

	/**
	 * Get occupied time ranges from all time slots
	 *
	 * @param {string} excludeClientId - Client ID to exclude from results
	 * @return {Array} Array of time range objects
	 */
	getOccupiedTimeRanges(excludeClientId = null) {
		const slots = excludeClientId
			? this.getSiblingTimeSlots(excludeClientId)
			: this.getAllTimeSlots();

		return slots.map((slot) => ({
			clientId: slot.clientId,
			startHour: slot.attributes.startHour || '09:00',
			endHour: slot.attributes.endHour || '10:00',
			length: slot.attributes.length || 1,
		}));
	}

	/**
	 * Check for time conflicts with a specific time slot
	 *
	 * @param {string} startHour - Start time in HH:mm format
	 * @param {string} endHour - End time in HH:mm format
	 * @param {string} excludeClientId - Client ID to exclude from conflict check
	 * @return {Array} Array of conflicting time slot blocks
	 */
	getConflictingSlots(startHour, endHour, excludeClientId = null) {
		const siblingSlots = this.getSiblingTimeSlots(excludeClientId);

		const currentStart = parse(startHour, 'HH:mm', new Date());
		const currentEnd = parse(endHour, 'HH:mm', new Date());

		return siblingSlots.filter((slot) => {
			const slotStart = parse(
				slot.attributes.startHour || '09:00',
				'HH:mm',
				new Date()
			);
			const slotEnd = parse(
				slot.attributes.endHour || '10:00',
				'HH:mm',
				new Date()
			);

			// Check if times overlap (accounting for next day scenarios)
			if (
				isAfter(slotEnd, slotStart) &&
				isAfter(currentEnd, currentStart)
			) {
				// Same day scenario
				return currentStart < slotEnd && currentEnd > slotStart;
			} else {
				// Handle cross-midnight scenarios - simplified for now
				return false;
			}
		});
	}

	/**
	 * Check if a time slot has conflicts
	 *
	 * @param {string} startHour - Start time in HH:mm format
	 * @param {string} endHour - End time in HH:mm format
	 * @param {string} excludeClientId - Client ID to exclude from conflict check
	 * @return {boolean} True if there are conflicts
	 */
	hasConflicts(startHour, endHour, excludeClientId = null) {
		return (
			this.getConflictingSlots(startHour, endHour, excludeClientId)
				.length > 0
		);
	}

	/**
	 * Get total number of time slots
	 *
	 * @return {number} Number of time slots
	 */
	getTimeSlotCount() {
		return this.allTimeSlots.length;
	}

	/**
	 * Get earliest start time from all time slots
	 *
	 * @return {string|null} Earliest start time in HH:mm format or null if no slots
	 */
	getEarliestStartTime() {
		if (this.allTimeSlots.length === 0) return null;

		const startTimes = this.allTimeSlots.map(
			(slot) => slot.attributes.startHour || '09:00'
		);

		return startTimes.reduce((earliest, current) => {
			const earliestTime = parse(earliest, 'HH:mm', new Date());
			const currentTime = parse(current, 'HH:mm', new Date());
			return currentTime < earliestTime ? current : earliest;
		});
	}

	/**
	 * Get latest end time from all time slots
	 *
	 * @return {string|null} Latest end time in HH:mm format or null if no slots
	 */
	getLatestEndTime() {
		if (this.allTimeSlots.length === 0) return null;

		const endTimes = this.allTimeSlots.map(
			(slot) => slot.attributes.endHour || '10:00'
		);

		return endTimes.reduce((latest, current) => {
			const latestTime = parse(latest, 'HH:mm', new Date());
			const currentTime = parse(current, 'HH:mm', new Date());
			return currentTime > latestTime ? current : latest;
		});
	}

	/**
	 * Get debug information about the time column
	 *
	 * @return {Object} Debug information object
	 */
	getDebugInfo() {
		return {
			parentId: this.parentId,
			timeSlotCount: this.getTimeSlotCount(),
			earliestStart: this.getEarliestStartTime(),
			latestEnd: this.getLatestEndTime(),
			occupiedRanges: this.getOccupiedTimeRanges(),
		};
	}
}
