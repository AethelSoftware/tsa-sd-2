import numpy as np

class VectorDB:
    def __init__(self, t: float):
        self.vectors = [] # Will be list of numpy arrays
        self.values = [] # This will be the list of cached responses
        self.threshold = t # Cosine similarity threshold value initialized here

    def insert(self, vector, value):
        # Insert the vector and value parameters into the correct lists
        self.vectors.append(vector)
        self.values.append(value)

    def compare(self, new_vector):
        # Use cosine similarity to compare the new vector with each vector in the vectors list
        # Essentially the objective is to find the best match THAT EXCEEDS the threshold
        # return None (or something else) if this condition is not met

        if not self.vectors:
            return None
        

        cosine_similarity_list = [np.dot(i, new_vector)/(np.linalg.norm(i * np.linalg.norm(new_vector))) for i in (self.vectors)]
        max_similarity_value = max(cosine_similarity_list)
        idx = self.vectors.index(max_similarity_value)
        return {"similarity": max_similarity_value, "value":self.values[idx]} if max_similarity_value >= self.threshold else None



