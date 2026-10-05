#pragma once
#include <vector>

/*
     DSA Unit 2: Circular queue
     OOP Unit 5: function templates
*/

template <class T>
class CircularQueue {
    std::vector<T> data;
    int maxSize;
    int start;
public:
    CircularQueue(int size = 10) {
        maxSize = size;
        start = 0;
    }

    void push(T value) {
        if (data.size() < maxSize) {
            data.push_back(value);
        } else {
            data[start] = value;
            start = (start + 1) % maxSize;
        }
    }

    std::vector<T> getAll() {
        std::vector<T> result;
        for (int i = 0; i < data.size(); i++) {
            int idx = (start + i) % data.size();
            result.push_back(data[idx]);
        }
        return result;
    }
};

// DSA Unit 2: Priority Queue (Min-Heap)
struct Threat {
    int satId;
    int debId;
    double distance;
};

class MinHeap {
    std::vector<Threat> h;
    void swapThreat(int i, int j) { 
        Threat temp = h[i]; 
        h[i] = h[j]; 
        h[j] = temp; 
    }
public:
    bool isEmpty() { return h.empty(); }
    
    void push(Threat t) {
        h.push_back(t);
        int i = h.size() - 1;
        while (i > 0) {
            int parent = (i - 1) / 2;
            if (h[parent].distance > h[i].distance) {
                swapThreat(parent, i);
                i = parent;
            } else {
                break;
            }
        }
    }

Threat popMin() {
        Threat top = h[0];
        h[0] = h[h.size() - 1];
        h.pop_back();
        int i = 0, n = h.size();
        while (true) {
            int left = 2 * i + 1;
            int right = 2 * i + 2;
            int smallest = i;
            
            if (left < n && h[left].distance < h[smallest].distance) 
                 smallest = left;
            if (right < n && h[right].distance < h[smallest].distance)
                 smallest = right;
            if (smallest == i) 
                 break;        
            swapThreat(i, smallest);
            i = smallest;
        }
        return top;
    }
};
