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

	// Extend the Uploaded filter to add Photo Author options.
	const OriginalUploaded = wp.media.view.AttachmentFilters.Uploaded;

	wp.media.view.AttachmentFilters.Uploaded = OriginalUploaded.extend({
		createFilters: function () {
			// Call parent to set up default filters.
			OriginalUploaded.prototype.createFilters.apply(this, arguments);

			// Only add author filters if we have the localized data.
			if (typeof fairAudienceMedia === 'undefined') {
				return;
			}

			// Add "All Authors" option (shows all, clears author filter).
			this.filters.all_authors = {
				text: fairAudienceMedia.allAuthors,
				props: {
					fair_photo_author: '',
					orderby: 'date',
					order: 'DESC',
				},
				priority: 50,
			};

			// Add individual author filters.
			if (
				fairAudienceMedia.participants &&
				fairAudienceMedia.participants.length > 0
			) {
				fairAudienceMedia.participants.forEach(function (
					participant,
					index
				) {
					this.filters['author_' + participant.id] = {
						text: participant.name,
						props: {
							fair_photo_author: participant.id.toString(),
							orderby: 'date',
							order: 'DESC',
						},
						priority: 51 + index,
					};
				},
				this);
			}
		},
	});
})(jQuery);
