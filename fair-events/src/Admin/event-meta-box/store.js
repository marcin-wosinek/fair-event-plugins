/**
 * WordPress dependencies
 */
import { createReduxStore, register } from '@wordpress/data';

const STORE_NAME = 'fair-events/event-data';

const DEFAULT_STATE = {
	eventData: null,
	loading: false,
	saving: false,
	error: null,
};

const actions = {
	setEventData(eventData) {
		return { type: 'SET_EVENT_DATA', eventData };
	},
	updateEventField(field, value) {
		return { type: 'UPDATE_EVENT_FIELD', field, value };
	},
	setLoading(loading) {
		return { type: 'SET_LOADING', loading };
	},
	setSaving(saving) {
		return { type: 'SET_SAVING', saving };
	},
	setError(error) {
		return { type: 'SET_ERROR', error };
	},
};

const selectors = {
	getEventData(state) {
		return state.eventData;
	},
	getEventField(state, field) {
		return state.eventData ? state.eventData[field] : undefined;
	},
	isLoading(state) {
		return state.loading;
	},
	isSaving(state) {
		return state.saving;
	},
	getError(state) {
		return state.error;
	},
};

function reducer(state = DEFAULT_STATE, action) {
	switch (action.type) {
		case 'SET_EVENT_DATA':
			return { ...state, eventData: action.eventData };
		case 'UPDATE_EVENT_FIELD':
			return {
				...state,
				eventData: state.eventData
					? { ...state.eventData, [action.field]: action.value }
					: { [action.field]: action.value },
			};
		case 'SET_LOADING':
			return { ...state, loading: action.loading };
		case 'SET_SAVING':
			return { ...state, saving: action.saving };
		case 'SET_ERROR':
			return { ...state, error: action.error };
		default:
			return state;
	}
}

const store = createReduxStore(STORE_NAME, {
	reducer,
	actions,
	selectors,
});

register(store);

export default store;
export { STORE_NAME };
