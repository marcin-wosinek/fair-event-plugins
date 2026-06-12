(function ($) {
	'use strict';

	// Ensure wp.media is available.
	if (
		typeof wp === 'undefined' ||
		!wp.media ||
		!wp.media.view ||
		!wp.media.view.AttachmentFilters
	) {
		return;
	}

	// Extend the Uploaded filter to add Event options.
	const OriginalUploaded = wp.media.view.AttachmentFilters.Uploaded;

	wp.media.view.AttachmentFilters.Uploaded = OriginalUploaded.extend({
		createFilters: function () {
			// Call parent to set up default filters.
			OriginalUploaded.prototype.createFilters.apply(this, arguments);

			// Only add event filters if we have the localized data.
			if (typeof fairEventsMedia === 'undefined') {
				return;
			}

			// Add individual event filters.
			if (fairEventsMedia.events && fairEventsMedia.events.length > 0) {
				fairEventsMedia.events.forEach(function (event, index) {
					this.filters['event_' + event.id] = {
						text: fairEventsMedia.eventPrefix + event.title,
						props: {
							fair_event_filter: event.id.toString(),
							orderby: 'date',
							order: 'DESC',
						},
						priority: 50 + index,
					};
				}, this);
			}
		},
	});
})(jQuery);
